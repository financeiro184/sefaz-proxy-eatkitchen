import axios from "axios";
import forge from "node-forge";

const SEFAZ_ENDPOINTS = {
  producao: "https://1200.macrorregiao.fazenda.gov.br/webservices/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx"
};

/**
 * Converte certificado PFX Base64 para arquivo temporário e extrai chave/cert
 * @param {string} certBase64 - Certificado A1 em Base64
 * @param {string} senha - Senha do certificado
 * @returns {Promise<{cert: string, key: string}>} - Cert e Key em PEM
 */
export async function extrairCertificadoEChave(certBase64, senha) {
  try {
    // Converter Base64 para Buffer
    const certBuffer = Buffer.from(certBase64, "base64");

    // Carregar certificado PKCS#12
    const p12Asn1 = forge.asn1.fromDer(certBuffer.toString("binary"));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, senha);

    // Extrair certificado
    let cert = null;
    let key = null;

    // Iterar sobre as bags para encontrar certificado e chave privada
    p12.getBags({ bagType: forge.pki.oids.certBag }).forEach((bag) => {
      bag.forEach((b) => {
        cert = forge.pki.certificateToPem(b.cert);
      });
    });

    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag }).forEach((bag) => {
      bag.forEach((b) => {
        key = forge.pki.privateKeyToPem(b.key);
      });
    });

    if (!cert || !key) {
      throw new Error("Certificado ou chave privada não encontrados no arquivo PKCS#12");
    }

    return { cert, key };
  } catch (error) {
    throw new Error(`Erro ao extrair certificado: ${error.message}`);
  }
}

/**
 * Formata CNPJ removendo caracteres especiais
 * @param {string} cnpj - CNPJ com ou sem formatação
 * @returns {string} - CNPJ apenas com dígitos
 */
function formatarCNPJ(cnpj) {
  return cnpj.replace(/\D/g, "");
}

/**
 * Formata NSU com zeros à esquerda
 * @param {string|number} nsu - NSU a formatar
 * @returns {string} - NSU formatado com 15 dígitos
 */
function formatarNSU(nsu) {
  return String(nsu).padStart(15, "0");
}

/**
 * Monta envelope SOAP para NFeDistribuicaoDFe
 * @param {string} cnpj - CNPJ
 * @param {string} uf - Código UF (ex: "42" para SC)
 * @param {string} ultimoNsu - Último NSU consultado
 * @returns {string} - Envelope SOAP
 */
function montarEnvelopeSoap(cnpj, uf, ultimoNsu) {
  const cnpjFormatado = formatarCNPJ(cnpj);
  const nsuFormatado = formatarNSU(ultimoNsu);

  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:dis="http://www.portalfiscal.inf.br/webservices/NFeDistribuicaoDFe">
  <soap:Header />
  <soap:Body>
    <dis:nfeDistribuicaoDFe>
      <dis:nfeDados>
        <dis:distDFeInt>
          <dis:idLote>1</dis:idLote>
          <dis:consNSU>
            <dis:CNPJ>${cnpjFormatado}</dis:CNPJ>
            <dis:assinaturaQR />
            <dis:NSU>${nsuFormatado}</dis:NSU>
          </dis:consNSU>
        </dis:distDFeInt>
      </dis:nfeDados>
    </dis:nfeDistribuicaoDFe>
  </soap:Body>
</soap:Envelope>`;

  return soapBody;
}

/**
 * Extrai dados da resposta XML SOAP
 * @param {string} xmlResponse - Resposta XML da SEFAZ
 * @returns {object} - Dados extraídos
 */
function extrairDadosResposta(xmlResponse) {
  try {
    // Extrair cStat
    const cStatMatch = xmlResponse.match(/<cStat>(\d+)<\/cStat>/);
    const cStat = cStatMatch ? cStatMatch[1] : null;

    // Extrair xMotivo
    const xMotivoMatch = xmlResponse.match(/<xMotivo>(.*?)<\/xMotivo>/);
    const xMotivo = xMotivoMatch ? xMotivoMatch[1] : "";

    // Extrair ultNSU
    const ultNSUMatch = xmlResponse.match(/<ultNSU>(\d+)<\/ultNSU>/);
    const ultNSU = ultNSUMatch ? ultNSUMatch[1] : "0";

    // Extrair maxNSU
    const maxNSUMatch = xmlResponse.match(/<maxNSU>(\d+)<\/maxNSU>/);
    const maxNSU = maxNSUMatch ? maxNSUMatch[1] : "0";

    // Extrair documentos
    const documentos = [];
    const docMatches = xmlResponse.matchAll(/<docZip>(.*?)<\/docZip>/gs);

    for (const match of docMatches) {
      const docZipContent = match[1];

      // Extrair NSU
      const nsuMatch = docZipContent.match(/<NSU>(\d+)<\/NSU>/);
      const nsu = nsuMatch ? nsuMatch[1] : "";

      // Extrair schema (para identificar tipo)
      const schemaMatch = docZipContent.match(/schema="([^"]+)"/);
      const schema = schemaMatch ? schemaMatch[1] : "xml_completo";

      // Extrair XML (geralmente comprimido em base64)
      const xmlMatch = docZipContent.match(/>(.*?)<\/docZip>/s);
      const xml = xmlMatch ? xmlMatch[1].trim() : "";

      if (nsu) {
        documentos.push({
          nsu: formatarNSU(nsu),
          chave_acesso: extrairChaveAcesso(xml),
          tipo_retorno: schema,
          xml: xml
        });
      }
    }

    return {
      cStat,
      xMotivo,
      ultNSU: formatarNSU(ultNSU),
      maxNSU: formatarNSU(maxNSU),
      documentos
    };
  } catch (error) {
    console.error("Erro ao extrair dados da resposta:", error);
    return null;
  }
}

/**
 * Extrai a chave de acesso do XML NFe
 * @param {string} xmlContent - Conteúdo XML
 * @returns {string} - Chave de acesso ou vazio
 */
function extrairChaveAcesso(xmlContent) {
  if (!xmlContent) return "";

  // Tentar extrair de atributo
  const attrMatch = xmlContent.match(/chave="(\d{44})"/);
  if (attrMatch) return attrMatch[1];

  // Tentar extrair de tag
  const tagMatch = xmlContent.match(/<chave>(\d{44})<\/chave>/);
  if (tagMatch) return tagMatch[1];

  return "";
}

/**
 * Consulta a SEFAZ com SOAP e mTLS
 * @param {string} cnpj - CNPJ
 * @param {string} uf - Código UF
 * @param {string} ultimoNsu - Último NSU
 * @param {string} certPem - Certificado em PEM
 * @param {string} keyPem - Chave privada em PEM
 * @param {string} ambiente - Ambiente (producao/homologacao)
 * @returns {Promise<object>} - Resposta formatada
 */
export async function consultarSefazDistribuicao(
  cnpj,
  uf,
  ultimoNsu,
  certPem,
  keyPem,
  ambiente = "producao"
) {
  try {
    const endpoint = SEFAZ_ENDPOINTS[ambiente];
    if (!endpoint) {
      throw new Error(`Ambiente não suportado: ${ambiente}`);
    }

    // Montar envelope SOAP
    const soapEnvelope = montarEnvelopeSoap(cnpj, uf, ultimoNsu);

    console.log("Enviando requisição SOAP para:", endpoint);
    console.log("CNPJ:", formatarCNPJ(cnpj));
    console.log("UF:", uf);
    console.log("Último NSU:", formatarNSU(ultimoNsu));

    // Requisição com mTLS
    const response = await axios.post(endpoint, soapEnvelope, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": "http://www.portalfiscal.inf.br/webservices/NFeDistribuicaoDFe"
      },
      httpsAgent: new (await import("https")).Agent({
        cert: certPem,
        key: keyPem,
        rejectUnauthorized: false // Para testes
      }),
      timeout: 30000
    });

    console.log("Resposta recebida da SEFAZ");

    // Extrair dados da resposta
    const dados = extrairDadosResposta(response.data);

    if (!dados) {
      throw new Error("Falha ao processar resposta SEFAZ");
    }

    // Verificar cStat
    if (dados.cStat === "137") {
      // Sem documentos novos
      return {
        success: true,
        cStat: dados.cStat,
        xMotivo: dados.xMotivo,
        ultNSU: dados.ultNSU,
        maxNSU: dados.maxNSU,
        documentos: []
      };
    } else if (dados.cStat === "138") {
      // Documentos encontrados
      return {
        success: true,
        cStat: dados.cStat,
        xMotivo: dados.xMotivo,
        ultNSU: dados.ultNSU,
        maxNSU: dados.maxNSU,
        documentos: dados.documentos
      };
    } else {
      // Outros códigos de status
      return {
        success: false,
        cStat: dados.cStat,
        xMotivo: dados.xMotivo,
        ultNSU: dados.ultNSU,
        maxNSU: dados.maxNSU,
        documentos: []
      };
    }
  } catch (error) {
    console.error("Erro ao consultar SEFAZ:", error);
    throw error;
  }
}
