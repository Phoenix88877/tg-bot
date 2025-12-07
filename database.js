// database.js
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const TABLE_USERS = "Users";
const TABLE_TRANSACTIONS = "Transactions";
const TABLE_CREDITS = "Credits";

/************************************************************
 * ИНИЦИАЛИЗАЦИЯ БАЗЫ
 ************************************************************/
function initDb(dbFileName = "finance.db") {
  const dbPath = path.join(__dirname, dbFileName);
  const db = new sqlite3.Database(dbPath);

  db.serialize(() => {
    /******************** USERS ********************/
    db.run(`
      CREATE TABLE IF NOT EXISTS ${TABLE_USERS} (
        id INTEGER PRIMARY KEY,
        first_name TEXT
      )
    `);

    /******************** TRANSACTIONS ********************/
    db.run(`
      CREATE TABLE IF NOT EXISTS ${TABLE_TRANSACTIONS} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        type TEXT NOT NULL,          -- 'income' | 'expense'
        name TEXT,
        category TEXT,
        subcategory TEXT,
        amount REAL NOT NULL,
        is_credit INTEGER DEFAULT 0,
        credit_id INTEGER,
        credit_name TEXT,
        date TEXT NOT NULL
      )
    `);

    /******************** CREDITS ********************/
    db.run(`
      CREATE TABLE IF NOT EXISTS ${TABLE_CREDITS} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        total REAL NOT NULL,              -- полная сумма кредита
        paid REAL NOT NULL DEFAULT 0,     -- уже выплачено
        percent REAL NOT NULL DEFAULT 0,  -- % годовых (просто для информации/плана)
        pay_day INTEGER NOT NULL,         -- день месяца (1–31)
        monthly_payment REAL NOT NULL DEFAULT 0  -- плановый ежемесячный платёж
      )
    `);
  });

  return db;
}

/************************************************************
 * РЕГИСТРАЦИЯ ПОЛЬЗОВАТЕЛЕЙ
 ************************************************************/
function ensureUserRegistered(db, from) {
  db.run(
    `INSERT OR IGNORE INTO ${TABLE_USERS} (id, first_name) VALUES (?, ?)`,
    [from.id, from.first_name || ""],
    (err) => {
      if (err) {
        console.error("ensureUserRegistered error:", err);
      }
    }
  );
}

/************************************************************
 * ТРАНЗАКЦИИ: ДОХОДЫ И РАСХОДЫ
 ************************************************************/
function saveTransaction(
  db,
  ownerId,
  type,          // 'income' | 'expense'
  name,
  amount,
  category,
  subcategory,
  isCredit = false,
  creditId = null,
  creditName = ""
) {
  const now = new Date().toISOString().slice(0, 10);

  db.run(
    `
    INSERT INTO ${TABLE_TRANSACTIONS}
      (owner_id, type, name, category, subcategory, amount, is_credit, credit_id, credit_name, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      ownerId,
      type,
      name,
      category || "",
      subcategory || "",
      amount,
      isCredit ? 1 : 0,
      creditId,
      creditName || "",
      now
    ],
    (err) => {
      if (err) {
        console.error("saveTransaction error:", err);
      }
    }
  );
}

function getAllTransactions(db, ownerId, callback) {
  let query = `SELECT * FROM ${TABLE_TRANSACTIONS}`;
  const params = [];

  if (ownerId != null) {
    query += " WHERE owner_id = ?";
    params.push(ownerId);
  }

  query += " ORDER BY date ASC, id ASC";

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error("getAllTransactions error:", err);
      return callback([]);
    }
    callback(rows);
  });
}

function getBalance(db, ownerId, callback) {
  db.get(
    `
    SELECT
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
    FROM ${TABLE_TRANSACTIONS}
    WHERE owner_id = ?
  `,
    [ownerId],
    (err, row) => {
      if (err) {
        console.error("getBalance error:", err);
        return callback({ income: 0, expense: 0 });
      }
      callback({
        income: row.income || 0,
        expense: row.expense || 0
      });
    }
  );
}

/************************************************************
 * КРЕДИТЫ
 ************************************************************/
function addCredit(
  db,
  ownerId,
  name,
  total,
  percent,
  payDay,
  monthlyPayment,
  callback
) {
  db.run(
    `
    INSERT INTO ${TABLE_CREDITS}
      (owner_id, name, total, paid, percent, pay_day, monthly_payment)
    VALUES (?, ?, ?, 0, ?, ?, ?)
  `,
    [ownerId, name, total, percent, payDay, monthlyPayment],
    function (err) {
      if (err) {
        console.error("addCredit error:", err);
        if (callback) callback(null);
        return;
      }
      if (callback) callback(this.lastID);
    }
  );
}

function getCreditsForOwner(db, ownerId, callback) {
  db.all(
    `
    SELECT *, (total - paid) AS remaining
    FROM ${TABLE_CREDITS}
    WHERE owner_id = ?
    ORDER BY name
  `,
    [ownerId],
    (err, rows) => {
      if (err) {
        console.error("getCreditsForOwner error:", err);
        return callback([]);
      }
      callback(rows);
    }
  );
}

function getAllCredits(db, callback) {
  db.all(
    `
    SELECT *, (total - paid) AS remaining
    FROM ${TABLE_CREDITS}
    ORDER BY owner_id, name
  `,
    [],
    (err, rows) => {
      if (err) {
        console.error("getAllCredits error:", err);
        return callback([]);
      }
      callback(rows);
    }
  );
}

function updateCreditPaid(db, creditId, amount, callback) {
  db.run(
    `
    UPDATE ${TABLE_CREDITS}
    SET paid = paid + ?
    WHERE id = ?
  `,
    [amount, creditId],
    (err) => {
      if (err) {
        console.error("updateCreditPaid error:", err);
      }
      if (callback) callback();
    }
  );
}

function deleteCredit(db, creditId, callback) {
  db.run(
    `DELETE FROM ${TABLE_CREDITS} WHERE id = ?`,
    [creditId],
    (err) => {
      if (err) {
        console.error("deleteCredit error:", err);
      }
      if (callback) callback();
    }
  );
}

function getCreditsDueToday(db, dayOfMonth, callback) {
  db.all(
    `
    SELECT *, (total - paid) AS remaining
    FROM ${TABLE_CREDITS}
    WHERE pay_day = ?
  `,
    [dayOfMonth],
    (err, rows) => {
      if (err) {
        console.error("getCreditsDueToday error:", err);
        return callback([]);
      }
      callback(rows);
    }
  );
}

module.exports = {
  initDb,
  ensureUserRegistered,
  saveTransaction,
  getAllTransactions,
  getBalance,
  addCredit,
  getCreditsForOwner,
  getAllCredits,
  updateCreditPaid,
  deleteCredit,
  getCreditsDueToday
};
