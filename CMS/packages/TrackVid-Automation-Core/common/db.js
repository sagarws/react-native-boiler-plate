const { loadEnv } = require("./loadEnv");
loadEnv();
// Required inside connectDB, not at module load. `mongodb` is an optional peer,
// and a consumer that never opens a connection should not need the driver
// installed — the Electron desktop app imports the claim flows, which reach
// this file through sessionStore, but supplies its own session and never calls
// connectDB. A top-level require would make that import fail outright.

let cachedClient = null;

async function connectDB() {
  if (cachedClient) {
    return cachedClient;
  }

  console.log("Connecting to MongoDB...");

  const { MongoClient } = require("mongodb");

  const client = new MongoClient(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    await client.connect();
    console.log("✅ MongoDB connected successfully.");
    cachedClient = client;
    return client;
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    throw err;
  }
}

async function closeDB(client) {
  if (client) {
    await client.close();
    console.log("🛑 MongoDB connection closed.");
  }
}

module.exports = { connectDB, closeDB}