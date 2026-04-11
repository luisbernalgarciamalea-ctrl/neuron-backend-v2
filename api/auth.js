// Neuron AI — /api/auth — Global user accounts via MongoDB
const https = require("https");
const crypto = require("crypto");

// Simple MongoDB REST via Data API (no driver needed in serverless)
// Uses MongoDB Atlas Data API
const MONGO_URI = process.env.MONGO_URI || "";
const DB_NAME = "neuron";
const COLLECTION = "users";

function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw + "neuron_2024_salt").digest("hex");
}

// Make a request to MongoDB Atlas Data API
// OR: fall back to direct driver if MONGO_DATA_API not set
function mongoRequest(action, body) {
  return new Promise((resolve, reject) => {
    const dataApiUrl = process.env.MONGO_DATA_API_URL; // optional Atlas Data API
    const dataApiKey = process.env.MONGO_DATA_API_KEY;

    if (!dataApiUrl || !dataApiKey) {
      // Fall back to native driver approach via dynamic import
      resolve(null);
      return;
    }

    const payload = JSON.stringify({
      dataSource: "GlobalStorageNeuronAI",
      database: DB_NAME,
      collection: COLLECTION,
      ...body
    });

    const url = new URL(dataApiUrl + "/action/" + action);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": dataApiKey,
        "Content-Length": Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ error: raw }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("Timeout")));
    req.write(payload);
    req.end();
  });
}

// Native MongoDB driver (works in Vercel if mongodb is in package.json)
let _client = null;
async function getCollection() {
  if (!MONGO_URI) throw new Error("MONGO_URI not set");
  if (!_client) {
    const { MongoClient } = require("mongodb");
    _client = new MongoClient(MONGO_URI);
    await _client.connect();
  }
  return _client.db(DB_NAME).collection(COLLECTION);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, name, email, password, plan } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const normalEmail = email.trim().toLowerCase();
  const hashedPw = hashPassword(password);

  try {
    const col = await getCollection();

    if (action === "register") {
      if (!name) return res.status(400).json({ error: "Name required" });

      const existing = await col.findOne({ email: normalEmail });
      if (existing) return res.status(409).json({ error: "An account with this email already exists. Please log in." });

      const user = {
        name: name.trim(),
        email: normalEmail,
        password: hashedPw,
        plan: plan || "Free",
        isDeveloper: plan === "Premium",
        createdAt: new Date().toISOString()
      };

      await col.insertOne(user);
      return res.status(200).json({ success: true, user: { name: user.name, email: user.email, plan: user.plan, isDeveloper: user.isDeveloper } });
    }

    if (action === "login") {
      const user = await col.findOne({ email: normalEmail, password: hashedPw });
      if (!user) return res.status(401).json({ error: "Invalid email or password." });
      return res.status(200).json({ success: true, user: { name: user.name, email: user.email, plan: user.plan, isDeveloper: user.isDeveloper } });
    }

    if (action === "updatePlan") {
      await col.updateOne({ email: normalEmail }, { $set: { plan, isDeveloper: plan === "Premium" } });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Unknown action" });

  } catch (err) {
    console.error("Auth error:", err.message);
    // Fallback: local-only mode if DB unavailable
    return res.status(503).json({ error: "Database unavailable: " + err.message, fallback: true });
  }
};
