// Neuron AI — /api/auth — Global user accounts via MongoDB
const https = require("https");
const crypto = require("crypto");
const { applyCors, handleOptions } = require("./_security.js");

// MongoDB configuration
const MONGO_URI = process.env.MONGO_URI || "";
const DB_NAME = "neuron";
const COLLECTION = "users";

function hashPassword(pw) {
  return crypto
    .createHash("sha256")
    .update(pw + "neuron_2024_salt")
    .digest("hex");
}

// Developer access is server-side only.
// The actual code must be stored in Vercel as DEV_PREMIUM_CODE.
const DEV_PREMIUM_CODE = String(
  process.env.DEV_PREMIUM_CODE || ""
).trim();

function validDeveloperCode(input) {
  const supplied = String(input || "").trim().slice(0, 128);

  if (
    !DEV_PREMIUM_CODE ||
    !supplied ||
    supplied.length !== DEV_PREMIUM_CODE.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(supplied),
    Buffer.from(DEV_PREMIUM_CODE)
  );
}

function publicUser(user) {
  return {
    name: user.name,
    email: user.email,
    plan: user.plan || "Free",
    isDeveloper: Boolean(user.isDeveloper)
  };
}

// Optional MongoDB Atlas Data API helper
function mongoRequest(action, body) {
  return new Promise((resolve, reject) => {
    const dataApiUrl = process.env.MONGO_DATA_API_URL;
    const dataApiKey = process.env.MONGO_DATA_API_KEY;

    if (!dataApiUrl || !dataApiKey) {
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

    const request = https.request(options, response => {
      let raw = "";

      response.on("data", chunk => {
        raw += chunk;
      });

      response.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve({ error: raw });
        }
      });
    });

    request.on("error", reject);

    request.setTimeout(10000, () => {
      request.destroy(new Error("MongoDB Data API timeout"));
    });

    request.write(payload);
    request.end();
  });
}

// Native MongoDB driver
let mongoClient = null;

async function getCollection() {
  if (!MONGO_URI) {
    throw new Error("MONGO_URI not set");
  }

  if (!mongoClient) {
    const { MongoClient } = require("mongodb");

    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
  }

  return mongoClient.db(DB_NAME).collection(COLLECTION);
}

module.exports = async function handler(req, res) {
  applyCors(req, res, "POST, OPTIONS");

  if (handleOptions(req, res)) {
    return;
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const {
    action,
    name,
    email,
    password,
    developerCode
  } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      error: "Email and password required"
    });
  }

  const normalEmail = String(email).trim().toLowerCase();
  const hashedPassword = hashPassword(String(password));

  try {
    const collection = await getCollection();

    // Register a new user
    if (action === "register") {
      if (!name) {
        return res.status(400).json({
          error: "Name required"
        });
      }

      const existingUser = await collection.findOne({
        email: normalEmail
      });

      if (existingUser) {
        return res.status(409).json({
          error: "An account with this email already exists. Please log in."
        });
      }

      const developerAccess = validDeveloperCode(developerCode);

      if (developerCode && !developerAccess) {
        return res.status(401).json({
          error: "Invalid developer code."
        });
      }

      const now = new Date().toISOString();

      const user = {
        name: String(name).trim(),
        email: normalEmail,
        password: hashedPassword,
        plan: developerAccess ? "Premium" : "Free",
        isDeveloper: developerAccess,
        createdAt: now
      };

      if (developerAccess) {
        user.developerActivatedAt = now;
      }

      await collection.insertOne(user);

      return res.status(200).json({
        success: true,
        user: publicUser(user)
      });
    }

    // Log in
    if (action === "login") {
      const user = await collection.findOne({
        email: normalEmail,
        password: hashedPassword
      });

      if (!user) {
        return res.status(401).json({
          error: "Invalid email or password."
        });
      }

      return res.status(200).json({
        success: true,
        user: publicUser(user)
      });
    }

    // Activate developer Premium access for an existing account
    if (action === "activateDeveloper") {
      const user = await collection.findOne({
        email: normalEmail,
        password: hashedPassword
      });

      if (!user) {
        return res.status(401).json({
          error: "Invalid email or password."
        });
      }

      if (!validDeveloperCode(developerCode)) {
        return res.status(401).json({
          error: "Invalid developer code."
        });
      }

      const activatedAt = new Date().toISOString();

      await collection.updateOne(
        {
          email: normalEmail
        },
        {
          $set: {
            plan: "Premium",
            isDeveloper: true,
            developerActivatedAt: activatedAt
          }
        }
      );

      return res.status(200).json({
        success: true,
        user: publicUser({
          ...user,
          plan: "Premium",
          isDeveloper: true
        })
      });
    }

    // Do not allow the browser to change plans directly
    if (action === "updatePlan") {
      return res.status(403).json({
        error: "Plan changes are managed by the server."
      });
    }

    return res.status(400).json({
      error: "Unknown action"
    });
  } catch (error) {
    console.error("Auth error:", error.message);

    return res.status(503).json({
      error: "Database unavailable: " + error.message,
      fallback: true
    });
  }
};
