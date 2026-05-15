import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import https from "https";
import { extrairCertificadoEChave, consultarSefazDistribuicao } from "./utils/sefaz-distribuicao.js";

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

/**
 * POST /api/sefaz/distribuicao-dfe
 * Consulta distribuição de DFe na SEFAZ
 *
 * Body esperado:
 * {
 *   "cnpj": "26993942000101",
 *   "uf": "42",
 *   "ambiente": "producao",
 *   "ultimo_nsu": "0",
 *   "tipo": "nfe"
 * }
 *
 * Retorna:
 * {
 *   "success": true,
 *   "cStat": "138",
 *   "xMotivo": "Documento localizado",
 *   "ultNSU": "000000000000123",
 *   "maxNSU": "000000000000150",
 *   "documentos": [...]
 * }
 */
app.post("/api/sefaz/distribuicao-dfe", validarToken, async (req, res) => {
  try {
    const { cnpj, uf, ambiente = "producao", ultimo_nsu = "0", tipo = "nfe" } = req.body;

    // Validar parâmetros obrigatórios
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

    // Validar tipo (por enquanto só NF-e)
    if (tipo !== "nfe") {
      return res.status(400).json({
        success: false,
        error: "Tipo deve ser 'nfe' (outros tipos em desenvolvimento)"
      });
    }

    // Obter certificado e senha
    const certBase64 =
      process.env.CERTIFICADO_26993942000101_PFX_BASE64 ||
      process.env.CERTIFICADO_EATKITCHEN_PFX_BASE64;

    const certSenha =
      process.env.CERTIFICADO_26993942000101_SENHA ||
      process.env.CERTIFICADO_EATKITCHEN_SENHA;

    console.log("=".repeat(60));
    console.log("Nova consulta SEFAZ recebida:");
    console.log({
      cnpj,
      uf,
      ambiente,
      ultimo_nsu,
      tipo,
      timestamp: new Date().toISOString()
    });
    console.log("=".repeat(60));

    // Validar certificado e senha
    if (!certBase64 || !certSenha) {
      return res.status(400).json({
        success: false,
        cStat: "CERTIFICADO_NAO_CONFIGURADO",
        xMotivo: "Certificado A1 ou senha não configurados nas variáveis do Railway.",
        ultNSU: String(ultimo_nsu).padStart(15, "0"),
        maxNSU: "000000000000000",
        documentos: []
      });
    }

    // Extrair certificado e chave
    console.log("Extraindo certificado A1...");
    const { cert, key } = await extrairCertificadoEChave(certBase64, certSenha);
    console.log("✓ Certificado extraído com sucesso");

    // Consultar SEFAZ
    console.log("Iniciando consulta SEFAZ...");
    const resultado = await consultarSefazDistribuicao(
      cnpj,
      uf,
      ultimo_nsu,
      cert,
      key,
      ambiente
    );

    console.log("✓ Consulta SEFAZ realizada com sucesso");
    console.log(`Resultado: cStat=${resultado.cStat}, documentos=${resultado.documentos.length}`);

    // Garantir que certificado/senha/key nunca sejam retornados
    return res.json(resultado);

  } catch (error) {
    console.error("❌ Erro na consulta SEFAZ:", {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    return res.status(500).json({
      success: false,
      cStat: "ERRO_PROXY",
      xMotivo: error.message || "Erro interno no Proxy SEFAZ",
      ultNSU: req.body?.ultimo_nsu ? String(req.body.ultimo_nsu).padStart(15, "0") : "000000000000000",
      maxNSU: "000000000000000",
      documentos: []
    });
  }
});

// Tratamento de erro 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint não encontrado"
  });
});

// Tratamento de erros global
app.use((err, req, res, next) => {
  console.error("Erro não tratado:", err);
  res.status(500).json({
    success: false,
    error: "Erro interno do servidor"
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Proxy SEFAZ rodando na porta ${PORT}`);
  console.log(`📍 Ambiente: ${process.env.SEFAZ_AMBIENTE || "producao"}`);
  console.log(`🔐 Token de proxy: ${PROXY_TOKEN ? "Configurado" : "NÃO CONFIGURADO"}`);
  console.log("\nEndpoints disponíveis:");
  console.log("  GET  /");
  console.log("  GET  /health");
  console.log("  GET  /certificado/status (requer Bearer Token)");
  console.log("  POST /api/sefaz/distribuicao-dfe (requer Bearer Token)");
  console.log("\n" + "=".repeat(60) + "\n");
});
