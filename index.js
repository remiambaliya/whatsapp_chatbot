const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();
const initDB = require("./db");

const app = express();
app.use(bodyParser.json());

const META_TOKEN = process.env.META_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "HiitsVerify";

let db;

// ✅ Send WhatsApp Message
async function sendWhatsAppMessage(to, body) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      },
      {
        headers: {
          Authorization: `Bearer ${META_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("✅ Message sent:", body);
  } catch (error) {
    console.error(
      "❌ Error sending message:",
      error.response?.data || error.message
    );
  }
}

// ✅ Fetch sum from financials
async function getFinancialSum(metric, fromDate, toDate) {
  const row = await db.get(
    `SELECT SUM(${metric}) as total 
     FROM financials 
     WHERE date BETWEEN ? AND ? AND company_id = 100`,
    [fromDate, toDate]
  );
  return row.total || 0;
}

// ✅ Parse user input
async function processUserMessage(msgText, selectedMetric = null) {
  try {
    const rangeRegex = /(\d{2})\/(\d{2})\s+to\s+(\d{2})\/(\d{2})/i;
    const rangeMatch = msgText.match(rangeRegex);

    const metricRegex =
      /(EBITDA|SALES|REVENUE|COGS|INVENTORY)\s+(\d{2})\/(\d{2})\s+to\s+(\d{2})\/(\d{2})/i;
    const metricMatch = msgText.match(metricRegex);

    if (metricMatch) {
      const metric = metricMatch[1].toLowerCase();
      const fromMonth = metricMatch[2];
      const fromYear = `20${metricMatch[3]}`;
      const toMonth = metricMatch[4];
      const toYear = `20${metricMatch[5]}`;

      const fromDate = `${fromYear}-${fromMonth}-01`;
      const toDate = `${toYear}-${toMonth}-31`;

      const total = await getFinancialSum(metric, fromDate, toDate);
      return `📊 ${metric.toUpperCase()} Report (${fromMonth}/${fromYear} → ${toMonth}/${toYear}): ₹${total.toLocaleString()}`;
    } else if (rangeMatch) {
      const fromMonth = rangeMatch[1];
      const fromYear = `20${rangeMatch[2]}`;
      const toMonth = rangeMatch[3];
      const toYear = `20${rangeMatch[4]}`;

      const fromDate = `${fromYear}-${fromMonth}-01`;
      const toDate = `${toYear}-${toMonth}-31`;

      if (selectedMetric) {
        const total = await getFinancialSum(selectedMetric, fromDate, toDate);
        return `📊 ${selectedMetric.toUpperCase()} Report (${fromMonth}/${fromYear} → ${toMonth}/${toYear}): ₹${total.toLocaleString()}`;
      }

      const ebitda = await getFinancialSum("ebitda", fromDate, toDate);
      const revenue = await getFinancialSum("revenue", fromDate, toDate);
      const sales = await getFinancialSum("sales", fromDate, toDate);
      const inventory = await getFinancialSum("inventory", fromDate, toDate);

      return (
        `📊 Report (${fromMonth}/${fromYear} → ${toMonth}/${toYear})\n` +
        `EBITDA: ₹${ebitda.toLocaleString()}\n` +
        `Revenue: ₹${revenue.toLocaleString()}\n` +
        `Sales: ₹${sales.toLocaleString()}\n` +
        `Inventory: ${inventory.toLocaleString()}`
      );
    } else {
      return (
        "Welcome to Business Analytics 📊\n\nChoose an option:\n" +
        "1️⃣ EBITDA\n2️⃣ Revenue\n3️⃣ Sales\n4️⃣ Inventory\n\n" +
        "Or try query directly:\n👉 EBITDA 01/25 to 03/25\n👉 01/25 to 03/25"
      );
    }
  } catch (err) {
    console.error("❌ Error parsing msg:", err.message);
    return "⚠️ Sorry, I couldn't process your query.";
  }
}

// ✅ Webhook Verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified!");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ✅ Incoming Webhook
app.post("/webhook", async (req, res) => {
  const data = req.body;

  if (data.object) {
    const messages = data.entry?.[0]?.changes?.[0]?.value?.messages;
    if (messages && messages[0]) {
      const msg = messages[0];
      const from = msg.from;
      const incomingMsg = msg.text?.body?.trim();

      console.log(`📩 Incoming from: ${from} | Msg: ${incomingMsg}`);

      await db.run(
        "INSERT INTO messages (from_number, message_text, direction) VALUES (?, ?, ?)",
        [from, incomingMsg, "in"]
      );

      let reply;
      let selectedMetric = null;

      if (["1", "2", "3", "4"].includes(incomingMsg)) {
        const metrics = {
          "1": "ebitda",
          "2": "revenue",
          "3": "sales",
          "4": "inventory",
        };
        selectedMetric = metrics[incomingMsg];

        // Save state in DB
        await db.run(
          "INSERT OR REPLACE INTO user_state (user_number, last_choice) VALUES (?, ?)",
          [from, selectedMetric]
        );

        reply =
          `You selected ${selectedMetric.toUpperCase()} ✅\n\n` +
          "Please provide date range (MM/YY to MM/YY)\n👉 Example: 01/25 to 03/25";
      } else {
        // Fetch state if exists
        const state = await db.get(
          "SELECT last_choice FROM user_state WHERE user_number = ?",
          [from]
        );
        if (state) {
          selectedMetric = state.last_choice;
        }
        reply = await processUserMessage(incomingMsg, selectedMetric);
      }

      await sendWhatsAppMessage(from, reply);

      await db.run(
        "INSERT INTO messages (from_number, message_text, direction) VALUES (?, ?, ?)",
        [from, reply, "out"]
      );
    }
  }

  res.sendStatus(200);
});

// ✅ Logs API
app.get("/logs", async (req, res) => {
  const rows = await db.all(
    "SELECT * FROM messages ORDER BY created_at DESC LIMIT 20"
  );
  res.json(rows);
});

// ✅ Start Server
const PORT = process.env.PORT || 3021;
initDB().then(async (database) => {
  db = database;

  // Ensure user_state table exists
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_state (
      user_number TEXT PRIMARY KEY,
      last_choice TEXT
    );
  `);

  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
});
