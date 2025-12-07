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
    /**************** USERS ****************/
    db.run(`
      CREATE TABLE IF NOT EXISTS ${TABLE_USERS} (
        id INTEGER PRIMARY KEY,
        first_name TEXT
      )
    `);

    /**************** TRANSACTIONS ****************/
    db.run(`
      CREATE TABLE IF NOT EXISTS ${TABLE_TRANSACTIONS} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER,
        name TEXT,
        amount REAL,
        type TEXT,
        category TEXT,
        isCredit INTEGER,
        creditName TEXT,
        date TEXT
      )
    `);

    /**************** CREDITS ****************/
    db.run(`
      CREATE TABLE IF NOT EXISTS ${TABLE_CREDITS} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER,
        name TEXT,
        amount REAL,
        percent REAL,
        paid REAL,
        payment_day INTEGER,
        next_payment_date TEXT
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
            if (err) console.error("ensureUserRegistered error:", err);
        }
    );
}

/************************************************************
 * ТРАНЗАКЦИИ: ДОХОДЫ И РАСХОДЫ
 ************************************************************/
function saveTransaction(db, from, type, name, amount, category, isCredit, creditName) {
    const now = new Date().toISOString().slice(0, 10);

    db.run(
        `
        INSERT INTO ${TABLE_TRANSACTIONS}
        (owner_id, name, amount, type, category, isCredit, creditName, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [from.id, name, amount, type, category, isCredit ? 1 : 0, creditName, now],
        (err) => {
            if (err) console.error("saveTransaction error:", err);
        }
    );
}
function getAllTransactions(db, ownerId, callback) {
  let query = `SELECT * FROM ${TABLE_TRANSACTIONS}`;
  let params = [];

  if (ownerId) {
    query += ` WHERE owner_id = ?`;
    params.push(ownerId);
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error("getAllTransactions:", err);
      return callback([]);
    }
    callback(rows);
  });
}

/************************************************************
 * ДОХОД / РАСХОД / БАЛАНС
 ************************************************************/
function getBalance(db, ownerId, callback) {
  db.all(
    `SELECT * FROM ${TABLE_TRANSACTIONS} WHERE owner_id = ?`,
    [ownerId],
    (err, rows) => {
      if (err) return callback({ income: 0, expense: 0 });

      let income = 0;
      let expense = 0;

      rows.forEach((t) => {
        if (t.type === "income") income += t.amount;
        if (t.type === "expense") expense += t.amount;
      });

      callback({ income, expense });
    }
  );
}

function getMonthlyIncome(db, ownerId, callback) {
  const nowMonth = new Date().toISOString().slice(0, 7);

  let query = `SELECT * FROM ${TABLE_TRANSACTIONS} WHERE date LIKE ? AND type = 'income'`;
  let params = [`${nowMonth}%`];

  if (ownerId) {
    query += ` AND owner_id = ?`;
    params.push(ownerId);
  }

  db.all(query, params, (err, rows) => {
    if (err) return callback(0);

    const sum = rows.reduce((acc, r) => acc + r.amount, 0);
    callback(sum);
  });
}

/************************************************************
 * КРЕДИТЫ
 ************************************************************/
function addCredit(db, ownerId, name, amount, percent, payment_day) {
  const today = new Date();
  const year = today.getFullYear();
  let month = today.getMonth();

  // Если день уже прошёл — переносим на следующий месяц
  if (today.getDate() > payment_day) {
    month += 1;
  }

  const nextDate = new Date(year, month, payment_day)
    .toISOString()
    .slice(0, 10);

  db.run(
    `
    INSERT INTO ${TABLE_CREDITS}
    (owner_id, name, amount, percent, paid, payment_day, next_payment_date)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `,
    [ownerId, name, amount, percent, payment_day, nextDate]
  );
}

function updateCreditPaid(db, ownerId, creditName, amount) {
  db.get(
    `
    SELECT * FROM ${TABLE_CREDITS}
    WHERE owner_id = ? AND name = ?
    `,
    [ownerId, creditName],
    (err, row) => {
      if (err || !row) return;

      const newPaid = Number(row.paid || 0) + Number(amount);

      db.run(
        `
        UPDATE ${TABLE_CREDITS}
        SET paid = ?
        WHERE id = ?
      `,
        [newPaid, row.id]
      );
    }
  );
}

function getCreditsForOwner(db, ownerId, callback) {
  db.all(
    `SELECT * FROM ${TABLE_CREDITS} WHERE owner_id = ?`,
    [ownerId],
    (err, rows) => {
      if (err) return callback([]);
      callback(rows);
    }
  );
}

function getAllCredits(db, callback) {
  db.all(`SELECT * FROM ${TABLE_CREDITS}`, [], (err, rows) => {
    if (err) return callback([]);
    callback(rows);
  });
}

/************************************************************
 * УДАЛЕНИЕ КРЕДИТА
 ************************************************************/
function deleteCredit(db, ownerId, creditName, callback) {
  db.run(
    `
    DELETE FROM ${TABLE_CREDITS}
    WHERE owner_id = ? AND name = ?
  `,
    [ownerId, creditName],
    (err) => {
      if (err) console.error("deleteCredit:", err);
      if (callback) callback();
    }
  );
}

/************************************************************
 * ЭКСПОРТ
 ************************************************************/
module.exports = {
  initDb,
  ensureUserRegistered,
  saveTransaction,
  getAllTransactions,
  getMonthlyIncome,
  getBalance,
  addCredit,
  getCreditsForOwner,
  getAllCredits,
  updateCreditPaid,
  deleteCredit
};




