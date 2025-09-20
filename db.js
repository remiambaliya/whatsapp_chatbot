const sqlite3 = require("sqlite3").verbose();
const { open } = require("sqlite");

async function initDB() {
  const db = await open({
    filename: "./analytics.sqlite3",
    driver: sqlite3.Database,
  });

  // ✅ Create messages table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_number TEXT,
      message_text TEXT,
      direction TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ✅ Create financials table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS financials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      company_id INT NOT NULL,
      name TEXT NOT NULL,
      revenue NUMERIC,
      cogs NUMERIC,
      ebitda NUMERIC,
      sales NUMERIC,
      inventory NUMERIC
    );
  `);

  // ✅ Insert sample data only if empty
  const row = await db.get("SELECT COUNT(*) as count FROM financials");
  if (row.count === 0) {
    await db.exec(`
      INSERT INTO financials (date, company_id, name, revenue, cogs, ebitda, sales, inventory) VALUES
      ('2025-01-15', 100, 'Global Ops', 1000000, 400000, 600000, 500000, 100),
      ('2025-02-15', 100, 'Global Ops', 1200000, 500000, 700000, 600000, 200),
      ('2025-03-15', 100, 'Global Ops', 1300000, 550000, 750000, 300000, 300),
      ('2024-01-15', 100, 'Global Ops', 900000, 380000, 520000, 200000, 400),
      ('2024-02-15', 100, 'Global Ops', 950000, 400000, 550000, 100000, 500),
      ('2024-03-15', 100, 'Global Ops', 1000000, 420000, 580000, 500000, 600);
    `);
    console.log("✅ Sample financial data inserted");
  }

  console.log("✅ SQLite3 DB ready with financials + messages");
  return db;
}

module.exports = initDB;
