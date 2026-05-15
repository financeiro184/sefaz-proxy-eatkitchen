import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;
const PROXY_TOKEN = process.env.SEFAZ_PROXY_TOKEN;

function validarToken(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.replace("Bearer ", "");

  if (!PROXY_TOKEN || token !== PROXY_TOKEN) {
    return res.status(401).json({
      success: false,
      error: "Token inválido ou ausente"
    });
  }

  next();
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Proxy SEFAZ Eat Kitchen online",
    endpoints: {
      health: "/health",
      certificadoStatus: "/certificado/status",
      distribuicaoDfe: "/api/sefaz/distribuicao-dfe"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Proxy SEFAZ Eat Kitchen online",
    ambiente: process.env.SEFAZ_AMBIENTE || "producao"
  });
});

app.get("/certificado/status", validarToken, (req, res) => {
  const certBase64 =
    process.env.CERTIFICADO_26993942000101_PFX_BASE64 ||
    process.env.CERTIFICADO_EATKITCHEN_PFX_BASE64;

  const certSenha =
    process.env.CERTIFICADO_26993942000101_SENHA ||
    process.env.CERTIFICADO_EATKITCHEN_SENHA;

  res.json({
    success: true,
    certificadoConfigurado: !!certBase64,
    senhaConfigurada: !!certSenha,
    tamanhoBase64: certBase64 ? certBase64.length : 0,
    message: certBase64 && certSenha
      ? "Certificado e senha configurados no proxy."
      : "Certificado ou senha ainda não configurados."
  });
});

app.post("/api/sefaz/distribuicao-dfe", validarToken, async (req, res) => {
  try {
    const { cnpj, uf, ambiente, ultimo_nsu, tipo } = req.body;

    if (!cnpj) {
      return res.status(400).json({
        success: false,
        error: "CNPJ obrigatório"
      });
    }

    if (!uf) {
      return res.status(400).json({
        success: false,
        error: "UF obrigatória"
      });
    }

    const certBase64 =
      process.env.CERTIFICADO_26993942000101_PFX_BASE64 ||
      process.env.CERTIFICADO_EATKITCHEN_PFX_BASE64;

    const certSenha =
      process.env.CERTIFICADO_26993942000101_SENHA ||
      process.env.CERTIFICADO_EATKITCHEN_SENHA;

    console.log("Consulta recebida:", {
      cnpj,
      uf,
      ambiente,
      ultimo_nsu,
      tipo,
      certificadoConfigurado: !!certBase64,
      senhaConfigurada: !!certSenha
    });

    if (!certBase64 || !certSenha) {
      return res.status(400).json({
        success: false,
        cStat: "CERTIFICADO_NAO_CONFIGURADO",
        xMotivo: "Certificado A1 ou senha não configurados nas variáveis do Railway.",
        ultNSU: ultimo_nsu || "0",
        maxNSU: "0",
        documentos: []
      });
    }

    /*
      CONSULTA REAL SEFAZ AINDA NÃO IMPLEMENTADA.

      Este proxy já:
      - está online;
      - valida token;
      - verifica se o certificado e senha estão configurados;
      - recebe a requisição do Base44;
      - retorna status técnico.

      Próximo passo:
      implementar aqui a consulta real NFeDistribuicaoDFe usando:
      - certificado A1 .pfx em Base64;
      - senha do certificado;
      - SOAP;
      - mTLS;
      - HTTP/1.1;
      - ambiente produção;
      - controle de NSU.
    */

    return res.json({
      success: false,
      cStat: "PROXY_ONLINE_SEM_CONSULTA_REAL",
      xMotivo: "Proxy online e certificado configurado, mas a consulta real à SEFAZ ainda precisa ser implementada.",
      ultNSU: ultimo_nsu || "0",
      maxNSU: "0",
      documentos: []
    });

  } catch (error) {
    console.error("Erro no proxy SEFAZ:", error);

    return res.status(500).json({
      success: false,
      cStat: "ERRO_PROXY",
      xMotivo: "Erro interno no Proxy SEFAZ",
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy SEFAZ rodando na porta ${PORT}`);
});
