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

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Proxy SEFAZ Eat Kitchen online",
    ambiente: process.env.SEFAZ_AMBIENTE || "producao"
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

    console.log("Consulta recebida:", {
      cnpj,
      uf,
      ambiente,
      ultimo_nsu,
      tipo
    });

    return res.json({
      success: false,
      cStat: "PROXY_ONLINE_SEM_CONSULTA_REAL",
      xMotivo: "Proxy online, mas a consulta real à SEFAZ ainda precisa ser implementada.",
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