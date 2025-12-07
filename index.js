// index.js
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const {
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
} = require("./database");

const { askLlama, analyzeExpenses } = require("./analytics");
const { generateIncomeExpenseChart } = require("./graphs");
const { initReminders } = require("./reminder");

/************************************************************
 * НАСТРОЙКИ / РОЛИ
 ************************************************************/
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const OWNER_MAIN = 1286874826;
const OWNER_WIFE = 825745634;

const ALLOWED_USERS = [OWNER_MAIN, OWNER_WIFE];

/************************************************************
 * ИНИЦИАЛИЗАЦИЯ
 ************************************************************/
const db = initDb("finance.db");
const bot = new TelegramBot(TOKEN, { polling: true });

console.log("🤖 Семейный финансовый бот запущен!");

initReminders(bot, db, getAllCredits, OWNER_MAIN);

/************************************************************
 * СОСТОЯНИЯ
 ************************************************************/
const userStates = new Map();

function getUserState(id) {
  return userStates.get(id) || null;
}
function saveUserState(id, obj) {
  userStates.set(id, obj);
}
function clearUserState(id) {
  userStates.delete(id);
}

/************************************************************
 * ВСПОМОГАТЕЛЬНЫЕ
 ************************************************************/
function isAllowedUser(id) {
  return ALLOWED_USERS.includes(Number(id));
}
function isMain(id) {
  return Number(id) === OWNER_MAIN;
}
function isWife(id) {
  return Number(id) === OWNER_WIFE;
}

function getMainMenuKeyboard(userId) {
  if (isWife(userId)) {
    return {
      reply_markup: {
        keyboard: [
          [{ text: "➕ Доход" }, { text: "➖ Расход" }],
          [{ text: "💳 Кредиты" }],
          [{ text: "📊 Баланс" }],
          [{ text: "📈 Анализ расходов (AI)" }],
          [{ text: "📉 График доходов/расходов" }]
        ],
        resize_keyboard: true
      }
    };
  }

  return {
    reply_markup: {
      keyboard: [
        [{ text: "➕ Доход" }, { text: "➖ Расход" }],
        [{ text: "💳 Кредиты" }],
        [{ text: "📊 Баланс" }, { text: "📅 План по кредитам" }],
        [{ text: "📈 Анализ расходов (AI)" }],
        [{ text: "📉 График доходов/расходов" }],
        [{ text: "🤖 AI-помощник" }]
      ],
      resize_keyboard: true
    }
  };
}

function showMainMenu(chatId, userId) {
  bot.sendMessage(chatId, "Выберите действие:", getMainMenuKeyboard(userId));
}

/************************************************************
 * МЕНЮ КРЕДИТОВ
 ************************************************************/
function showCreditsMenu(chatId) {
  bot.sendMessage(chatId, "Выберите действие:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ Добавить кредит", callback_data: "add_credit" }],
        [{ text: "📋 Список кредитов", callback_data: "show_credit_list" }],
        [{ text: "💰 Оплатить кредит", callback_data: "pay_credit" }],
        [{ text: "🗑 Удалить кредит", callback_data: "delete_credit" }]
      ]
    }
  });
}

function showCreditListFor(db, chatId, userId) {
  if (isMain(userId)) {
    getAllCredits(db, (credits) => sendCreditList(chatId, credits));
  } else {
    getCreditsForOwner(db, userId, (credits) =>
      sendCreditList(chatId, credits)
    );
  }
}

function sendCreditList(chatId, credits) {
  if (!credits.length)
    return bot.sendMessage(chatId, "Кредитов нет.");

  let text = "📋 *Кредиты:*\n\n";
  let total = 0;

  credits.forEach((c) => {
    const remain = c.amount - c.paid;
    total += remain;

    const who = c.owner_id === OWNER_MAIN ? "👨" : "👩";

    text += `${who} *${c.name}*\n` +
            `• Сумма: ${c.amount}\n` +
            `• Выплачено: ${c.paid}\n` +
            `• Остаток: ${remain}\n` +
            `• %: ${c.percent}%\n\n`;
  });

  text += `💰 *Общий долг:* ${total}`;

  bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

function showCreditChooseForPayment(chatId, userId) {
  if (isMain(userId)) {
    getAllCredits(db, (credits) =>
      sendCreditChooseList(chatId, credits, "choose_credit_payment")
    );
  } else {
    getCreditsForOwner(db, userId, (credits) =>
      sendCreditChooseList(chatId, credits, "choose_credit_payment")
    );
  }
}

function showCreditChooseForDelete(chatId, userId) {
  if (isMain(userId)) {
    getAllCredits(db, (credits) =>
      sendCreditChooseList(chatId, credits, "choose_credit_delete")
    );
  } else {
    getCreditsForOwner(db, userId, (credits) =>
      sendCreditChooseList(chatId, credits, "choose_credit_delete")
    );
  }
}

function sendCreditChooseList(chatId, credits, action) {
  if (!credits.length)
    return bot.sendMessage(chatId, "Нет кредитов.");

  const rows = credits.map((c) => [
    {
      text: (c.owner_id === OWNER_MAIN ? "👨 " : "👩 ") + c.name,
      callback_data: `${action}|${c.name}|${c.owner_id}`
    }
  ]);

  bot.sendMessage(chatId, "Выберите кредит:", {
    reply_markup: { inline_keyboard: rows }
  });
}

/************************************************************
 * БАЛАНС
 ************************************************************/
function showBalance(chatId, userId) {
  if (isWife(userId)) {
    getBalance(db, userId, ({ income, expense }) => {
      const bal = income - expense;
      bot.sendMessage(chatId,
        `📊 *Ваш баланс*\n\n` +
        `Доход: *${income}*\n` +
        `Расход: *${expense}*\n` +
        `Итог: *${bal}*`,
        { parse_mode: "Markdown" }
      );
    });
  } else {
    getBalance(db, OWNER_MAIN, (m) => {
      getBalance(db, OWNER_WIFE, (w) => {
        bot.sendMessage(chatId,
          `📊 *Семейный баланс*\n\n` +
          `👨 Муж: доход ${m.income}, расход ${m.expense}\n` +
          `👩 Жена: доход ${w.income}, расход ${w.expense}\n\n` +
          `🏡 Семья: доход ${m.income + w.income}, расход ${m.expense + w.expense}`,
          { parse_mode: "Markdown" }
        );
      });
    });
  }
}

/************************************************************
 * ПЛАН ПО КРЕДИТАМ
 ************************************************************/
function showCreditPlan(chatId, userId) {
  const loader = isMain(userId) ? getAllCredits : getCreditsForOwner;

  if (isMain(userId)) {
    loader(db, (credits) => sendPlanText(chatId, credits, null));
  } else {
    loader(db, userId, (credits) => sendPlanText(chatId, credits, userId));
  }
}

function sendPlanText(chatId, credits, ownerId) {
  getMonthlyIncome(db, ownerId, (income) => {
    let monthly = 0;

    credits.forEach((c) => {
      monthly += c.amount * (c.percent / 100 / 12);
    });

    bot.sendMessage(
      chatId,
      `📅 *План по кредитам*\n\n` +
        `Доход в месяц: *${income}*\n` +
        `Проценты в месяц: *${monthly.toFixed(2)}*`,
      { parse_mode: "Markdown" }
    );
  });
}

/************************************************************
 * ДОХОД / РАСХОД
 ************************************************************/
function beginAddIncome(chatId, userId) {
  saveUserState(userId, { state: "income_amount" });
  bot.sendMessage(chatId, "Введите сумму дохода:");
}

function beginAddExpense(chatId, userId) {
  saveUserState(userId, { state: "expense_amount" });
  bot.sendMessage(chatId, "Введите сумму расхода:");
}

/************************************************************
 * ОБРАБОТКА СООБЩЕНИЙ
 ************************************************************/
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (msg.text || "").trim();

  if (!isAllowedUser(userId))
    return bot.sendMessage(chatId, "⛔ Нет доступа.");

  ensureUserRegistered(db, msg.from);

  if (text === "/start") return showMainMenu(chatId, userId);

  if (text === "🤖 AI-помощник") {
    saveUserState(userId, { state: "ai_mode" });
    return bot.sendMessage(chatId, "🧠 Напиши вопрос.");
  }

  const state = getUserState(userId);

  if (state?.state === "ai_mode") {
    try {
      const reply = await askLlama(text);
      return bot.sendMessage(chatId, reply);
    } catch {
      return bot.sendMessage(chatId, "❌ Ошибка AI.");
    }
  }

  if (text === "➕ Доход") return beginAddIncome(chatId, userId);
  if (text === "➖ Расход") return beginAddExpense(chatId, userId);
  if (text === "💳 Кредиты") return showCreditsMenu(chatId);
  if (text === "📊 Баланс") return showBalance(chatId, userId);
  if (text === "📅 План по кредитам") return showCreditPlan(chatId, userId);

  if (text === "📈 Анализ расходов (AI)") {
    const isFamily = isMain(userId);
    const owner = isFamily ? null : userId;

    const result = await analyzeExpenses(db, getAllTransactions, owner, isFamily);
    return bot.sendMessage(chatId, result, { parse_mode: "Markdown" });
  }

  if (text === "📉 График доходов/расходов") {
    const isFamily = isMain(userId);
    const owner = isFamily ? null : userId;

    try {
      const img = await generateIncomeExpenseChart(db, getAllTransactions, owner, isFamily);
      return bot.sendPhoto(chatId, img);
    } catch {
      return bot.sendMessage(chatId, "❌ Недостаточно данных.");
    }
  }

  const stateObj = getUserState(userId);
  if (stateObj) return handleStateMessage(msg, stateObj);

  if (isMain(userId)) {
    try {
      const answer = await askLlama(text);
      return bot.sendMessage(chatId, answer);
    } catch {
      return bot.sendMessage(chatId, "❌ Ошибка Llama.");
    }
  }

  bot.sendMessage(chatId, "Используй кнопки 😊");
});

/************************************************************
 * CALLBACK-QUERY
 ************************************************************/
bot.on("callback_query", (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  const [action, name, owner] = data.split("|");

  switch (action) {
    case "add_credit":
      saveUserState(userId, { state: "credit_name" });
      bot.sendMessage(chatId, "Введите название кредита:");
      break;

    case "show_credit_list":
      showCreditListFor(db, chatId, userId);
      break;

    case "pay_credit":
      showCreditChooseForPayment(chatId, userId);
      break;

    case "choose_credit_payment":
      saveUserState(userId, {
        state: "credit_payment_amount",
        creditName: name,
        creditOwnerId: Number(owner)
      });
      bot.sendMessage(chatId, "Введите сумму платежа:");
      break;

    case "delete_credit":
      showCreditChooseForDelete(chatId, userId);
      break;

    case "choose_credit_delete":
      deleteCredit(db, Number(owner), name, () => {
        bot.sendMessage(chatId, `🗑 Кредит *${name}* удалён`, {
          parse_mode: "Markdown"
        });
      });
      break;
  }

  bot.answerCallbackQuery(query.id);
});

/************************************************************
 * ОБРАБОТКА СОСТОЯНИЙ
 ************************************************************/
function handleStateMessage(msg, stateObj) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();

  switch (stateObj.state) {
    case "income_amount":
      saveTransaction(db, msg.from, "income", "Доход", Number(text), "", false, "");
      clearUserState(userId);
      bot.sendMessage(chatId, "Доход сохранён", getMainMenuKeyboard(userId));
      break;

    case "expense_amount":
      saveTransaction(db, msg.from, "expense", "Расход", Number(text), "", false, "");
      clearUserState(userId);
      bot.sendMessage(chatId, "Расход сохранён", getMainMenuKeyboard(userId));
      break;

    case "credit_name":
      stateObj.name = text;
      stateObj.state = "credit_amount";
      saveUserState(userId, stateObj);
      bot.sendMessage(chatId, "Введите сумму кредита:");
      break;

    case "credit_amount":
      stateObj.amount = Number(text);
      stateObj.state = "credit_percent";
      saveUserState(userId, stateObj);
      bot.sendMessage(chatId, "Введите процент:");
      break;

    case "credit_percent":
      stateObj.percent = Number(text);
      stateObj.state = "credit_day";
      saveUserState(userId, stateObj);
      bot.sendMessage(chatId, "Введите день платежа (1–31):");
      break;

    case "credit_day":
      const payDay = Number(text);
      addCredit(db, userId, stateObj.name, stateObj.amount, stateObj.percent, payDay);
      clearUserState(userId);
      bot.sendMessage(chatId, "Кредит добавлен! ✔ Напоминания включены.", getMainMenuKeyboard(userId));
      break;

    case "credit_payment_amount":
      const sum = Number(text);
      updateCreditPaid(db, stateObj.creditOwnerId, stateObj.creditName, sum);

      saveTransaction(db, msg.from, "expense", "Кредиты", sum, "", true, stateObj.creditName);

      clearUserState(userId);
      bot.sendMessage(chatId, "Платёж сохранён!", getMainMenuKeyboard(userId));
      break;
  }
}
