import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = process.env.PORT || 5173;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = __dirname;

const app = express();
app.use(express.static(staticDir));

app.get("*", (req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Lisa site available at http://localhost:${PORT}`);
});


