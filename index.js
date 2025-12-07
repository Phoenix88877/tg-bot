// index.js
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const {
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
} = require("./database");

const { askLlama, analyzeExpenses } = require("./analytics");
const { generateIncomeExpenseChart } = require("./graphs");
const { initReminders } = require("./reminder");

/************************************************************
 * НАСТРОЙКИ / РОЛИ
 ************************************************************/
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// заменишь на свои ID (они у тебя уже были)
const OWNER_MAIN = 1286874826;
const OWNER_WIFE = 825745634;

const ALLOWED_USERS = [OWNER_MAIN, OWNER_WIFE];

/************************************************************
 * КАТЕГОРИИ / ПОДКАТЕГОРИИ
 ************************************************************/
const INCOME_CATEGORIES = {
  "Зарплата": ["Оклад", "Премия", "Бонус"],
  "Бизнес": ["Продажи", "Услуги"],
  "Подарки": ["Семья", "Друзья"],
  "Проценты": ["Банк", "Инвестиции"],
  "Прочее": ["Разное"]
};

const EXPENSE_CATEGORIES = {
  "Еда": ["Продукты", "Кафе"],
  "Покупки": ["Одежда", "Дом", "Мелочи"],
  "Дом": ["Коммуналка", "Аренда", "Ремонт"],
  "Машина": ["Топливо", "Ремонт", "Страховка"],
  "Развлечения": ["Кино", "Путешествия", "Кафе/Бар"],
  "Здоровье": ["Аптека", "Лечение"],
  "Кредиты": ["Платёж по кредиту"],
  "Прочее": ["Разное"]
};

const CREDIT_CATEGORY_NAME = "Кредиты";

/************************************************************
 * ИНИЦИАЛИЗАЦИЯ
 ************************************************************/
const db = initDb("finance.db");
const bot = new TelegramBot(TOKEN, { polling: true });

console.log("🤖 Семейный финансовый бот запущен!");

// напоминания по кредитам (главному владельцу)
initReminders(bot, db, getCreditsDueToday, OWNER_MAIN);

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

  // главный
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
 * КРЕДИТЫ – МЕНЮ/СПИСКИ
 ************************************************************/
function showCreditsMenu(chatId) {
  bot.sendMessage(chatId, "Выберите действие:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ Добавить кредит", callback_data: "credit:add" }],
        [{ text: "📋 Список кредитов", callback_data: "credit:list" }],
        [{ text: "💰 Оплатить кредит", callback_data: "credit:pay" }],
        [{ text: "🗑 Удалить кредит", callback_data: "credit:delete" }]
      ]
    }
  });
}

function sendCreditList(chatId, credits) {
  if (!credits.length) {
    return bot.sendMessage(chatId, "Кредитов нет.");
  }

  let text = "📋 *Кредиты:*\n\n";

  credits.forEach((c) => {
    const remaining = Math.max(0, (c.total || 0) - (c.paid || 0));

    text +=
      `*${c.name}*\n` +
      `• Полная сумма: ${c.total}\n` +
      `• Выплачено: ${c.paid}\n` +
      `• Остаток: ${remaining}\n` +
      `• % годовых: ${c.percent}\n` +
      `• Ежемесячный платёж: ${c.monthly_payment}\n` +
      `• День платежа: ${c.pay_day}\n\n`;
  });

  bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

function showCreditListFor(chatId, userId) {
  if (isMain(userId)) {
    getAllCredits(db, (credits) => sendCreditList(chatId, credits));
  } else {
    getCreditsForOwner(db, userId, (credits) => sendCreditList(chatId, credits));
  }
}

function sendCreditChooseList(chatId, credits, actionPrefix) {
  if (!credits.length) {
    return bot.sendMessage(chatId, "Нет кредитов.");
  }

  const rows = credits.map((c) => {
    const remaining = Math.max(0, (c.total || 0) - (c.paid || 0));
    return [
      {
        text: `${c.name} (осталось ${remaining})`,
        callback_data: `${actionPrefix}:${c.id}`
      }
    ];
  });

  bot.sendMessage(chatId, "Выберите кредит:", {
    reply_markup: { inline_keyboard: rows }
  });
}

function showCreditChooseForPayment(chatId, userId) {
  if (isMain(userId)) {
    getAllCredits(db, (credits) =>
      sendCreditChooseList(chatId, credits, "credit_pay")
    );
  } else {
    getCreditsForOwner(db, userId, (credits) =>
      sendCreditChooseList(chatId, credits, "credit_pay")
    );
  }
}

function showCreditChooseForDelete(chatId, userId) {
  if (isMain(userId)) {
    getAllCredits(db, (credits) =>
      sendCreditChooseList(chatId, credits, "credit_del")
    );
  } else {
    getCreditsForOwner(db, userId, (credits) =>
      sendCreditChooseList(chatId, credits, "credit_del")
    );
  }
}

/************************************************************
 * БАЛАНС
 ************************************************************/
function showBalance(chatId, userId) {
  if (isWife(userId)) {
    getBalance(db, userId, ({ income, expense }) => {
      const bal = income - expense;
      bot.sendMessage(
        chatId,
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
        const familyIncome = (m.income || 0) + (w.income || 0);
        const familyExpense = (m.expense || 0) + (w.expense || 0);

        bot.sendMessage(
          chatId,
          `📊 *Семейный баланс*\n\n` +
            `👨 Муж: доход ${m.income}, расход ${m.expense}\n` +
            `👩 Жена: доход ${w.income}, расход ${w.expense}\n\n` +
            `🏡 Семья: доход ${familyIncome}, расход ${familyExpense}`,
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

  loader(db, isMain(userId) ? null : userId, (credits) => {
    if (!credits.length) {
      return bot.sendMessage(chatId, "Кредитов нет.");
    }

    let text = "📅 *План по кредитам*\n\n";

    credits.forEach((c) => {
      const remaining = Math.max(0, (c.total || 0) - (c.paid || 0));
      let monthsLeft = 0;

      if (c.monthly_payment > 0) {
        monthsLeft = Math.ceil(remaining / c.monthly_payment);
      }

      text +=
        `*${c.name}*\n` +
        `• Остаток: ${remaining}\n` +
        `• Плановый ежемесячный платёж: ${c.monthly_payment}\n` +
        `• Примерно месяцев до погашения: ${monthsLeft}\n` +
        `• День платежа: ${c.pay_day}\n\n`;
    });

    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });
}

/************************************************************
 * КАТЕГОРИИ / ПОДКАТЕГОРИИ – КЛАВИАТУРЫ
 ************************************************************/
function buildCategoryKeyboard(map, prefix) {
  return {
    reply_markup: {
      inline_keyboard: Object.keys(map).map((cat) => [
        { text: cat, callback_data: `${prefix}_cat:${cat}` }
      ])
    }
  };
}

function buildSubcategoryKeyboard(map, category, prefix) {
  const subs = map[category] || [];
  if (!subs.length) return null;

  return {
    reply_markup: {
      inline_keyboard: subs.map((sub) => [
        { text: sub, callback_data: `${prefix}_sub:${category}:${sub}` }
      ])
    }
  };
}

/************************************************************
 * ОБРАБОТКА СООБЩЕНИЙ
 ************************************************************/
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (msg.text || "").trim();

  if (!isAllowedUser(userId)) {
    return bot.sendMessage(chatId, "⛔ Нет доступа.");
  }

  ensureUserRegistered(db, msg.from);

  if (text === "/start") {
    clearUserState(userId);
    return showMainMenu(chatId, userId);
  }

  if (text === "🤖 AI-помощник") {
    saveUserState(userId, { state: "ai_mode" });
    return bot.sendMessage(chatId, "🧠 Напиши вопрос.");
  }

  const state = getUserState(userId);

  // режим AI
  if (state?.state === "ai_mode") {
    try {
      const reply = await askLlama(text);
      return bot.sendMessage(chatId, reply);
    } catch (e) {
      console.error(e);
      return bot.sendMessage(chatId, "❌ Ошибка AI.");
    }
  }

  // Кнопки меню
  if (text === "➕ Доход") {
    saveUserState(userId, { state: "income_choose_category" });
    return bot.sendMessage(
      chatId,
      "Выберите категорию дохода:",
      buildCategoryKeyboard(INCOME_CATEGORIES, "inc")
    );
  }

  if (text === "➖ Расход") {
    saveUserState(userId, { state: "expense_choose_category" });
    return bot.sendMessage(
      chatId,
      "Выберите категорию расхода:",
      buildCategoryKeyboard(EXPENSE_CATEGORIES, "exp")
    );
  }

  if (text === "💳 Кредиты") {
    return showCreditsMenu(chatId);
  }

  if (text === "📊 Баланс") {
    return showBalance(chatId, userId);
  }

  if (text === "📅 План по кредитам") {
    return showCreditPlan(chatId, userId);
  }

  if (text === "📈 Анализ расходов (AI)") {
    const isFamily = isMain(userId);
    const owner = isFamily ? null : userId;

    const result = await analyzeExpenses(
      db,
      getAllTransactions,
      owner,
      isFamily
    );
    return bot.sendMessage(chatId, result, { parse_mode: "Markdown" });
  }

  if (text === "📉 График доходов/расходов") {
    const isFamily = isMain(userId);
    const owner = isFamily ? null : userId;

    try {
      const img = await generateIncomeExpenseChart(
        db,
        getAllTransactions,
        owner,
        isFamily
      );
      return bot.sendPhoto(chatId, img);
    } catch (e) {
      console.error(e);
      return bot.sendMessage(chatId, "❌ Недостаточно данных.");
    }
  }

  // Если есть состояние — обрабатываем его
  const stateObj = getUserState(userId);
  if (stateObj) return handleStateMessage(msg, stateObj);

  // Если пользователь — главный и мы не в состоянии, можно отправить вопрос в AI
  if (isMain(userId)) {
    try {
      const answer = await askLlama(text);
      return bot.sendMessage(chatId, answer);
    } catch (e) {
      console.error(e);
      return bot.sendMessage(chatId, "❌ Ошибка Llama.");
    }
  }

  bot.sendMessage(chatId, "Используй кнопки 😊");
});

/************************************************************
 * CALLBACK-QUERY (кнопки inline)
 ************************************************************/
bot.on("callback_query", (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  // КРЕДИТЫ
  if (data === "credit:add") {
    saveUserState(userId, { state: "credit_name" });
    bot.sendMessage(chatId, "Введите название кредита:");
  } else if (data === "credit:list") {
    showCreditListFor(chatId, userId);
  } else if (data === "credit:pay") {
    showCreditChooseForPayment(chatId, userId);
  } else if (data === "credit:delete") {
    showCreditChooseForDelete(chatId, userId);
  } else if (data.startsWith("credit_pay:")) {
    const creditId = Number(data.split(":")[1]);
    saveUserState(userId, {
      state: "credit_payment_amount",
      creditId
    });
    bot.sendMessage(chatId, "Введите сумму платежа:");
  } else if (data.startsWith("credit_del:")) {
    const creditId = Number(data.split(":")[1]);
    deleteCredit(db, creditId, () => {
      bot.sendMessage(chatId, "🗑 Кредит удалён.");
    });
  }

  // ДОХОДЫ/РАСХОДЫ – КАТЕГОРИИ/ПОДКАТЕГОРИИ
  else if (data.startsWith("inc_cat:")) {
    const category = data.substring("inc_cat:".length);
    saveUserState(userId, {
      state: "income_choose_subcategory",
      category
    });

    const keyboard = buildSubcategoryKeyboard(
      INCOME_CATEGORIES,
      category,
      "inc"
    );

    if (keyboard) {
      bot.sendMessage(chatId, "Выберите подкатегорию дохода:", keyboard);
    } else {
      saveUserState(userId, {
        state: "income_amount",
        category,
        subcategory: ""
      });
      bot.sendMessage(chatId, "Введите сумму дохода:");
    }
  } else if (data.startsWith("inc_sub:")) {
    const [, category, subcategory] = data.split(":");
    saveUserState(userId, {
      state: "income_amount",
      category,
      subcategory
    });
    bot.sendMessage(chatId, "Введите сумму дохода:");
  } else if (data.startsWith("exp_cat:")) {
    const category = data.substring("exp_cat:".length);
    saveUserState(userId, {
      state: "expense_choose_subcategory",
      category
    });

    const keyboard = buildSubcategoryKeyboard(
      EXPENSE_CATEGORIES,
      category,
      "exp"
    );

    if (keyboard) {
      bot.sendMessage(chatId, "Выберите подкатегорию расхода:", keyboard);
    } else {
      saveUserState(userId, {
        state: "expense_amount",
        category,
        subcategory: ""
      });
      bot.sendMessage(chatId, "Введите сумму расхода:");
    }
  } else if (data.startsWith("exp_sub:")) {
    const [, category, subcategory] = data.split(":");
    saveUserState(userId, {
      state: "expense_amount",
      category,
      subcategory
    });
    bot.sendMessage(chatId, "Введите сумму расхода:");
  }

  bot.answerCallbackQuery(query.id);
});

/************************************************************
 * ОБРАБОТКА СОСТОЯНИЙ (ВВОД СУММ, ДАННЫЕ ПО КРЕДИТАМ)
 ************************************************************/
function parseAmount(text) {
  const num = Number(String(text).replace(",", "."));
  return isNaN(num) ? null : num;
}

function handleStateMessage(msg, stateObj) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (msg.text || "").trim();

  switch (stateObj.state) {
    /**************** ДОХОД ****************/
    case "income_amount": {
      const amount = parseAmount(text);
      if (amount == null || amount <= 0) {
        return bot.sendMessage(chatId, "Введите корректную сумму дохода.");
      }

      saveTransaction(
        db,
        userId,
        "income",
        "Доход",
        amount,
        stateObj.category,
        stateObj.subcategory
      );

      clearUserState(userId);
      bot.sendMessage(chatId, "Доход сохранён ✅", getMainMenuKeyboard(userId));
      break;
    }

    /**************** РАСХОД ****************/
    case "expense_amount": {
      const amount = parseAmount(text);
      if (amount == null || amount <= 0) {
        return bot.sendMessage(chatId, "Введите корректную сумму расхода.");
      }

      saveTransaction(
        db,
        userId,
        "expense",
        "Расход",
        amount,
        stateObj.category,
        stateObj.subcategory
      );

      clearUserState(userId);
      bot.sendMessage(chatId, "Расход сохранён ✅", getMainMenuKeyboard(userId));
      break;
    }

    /**************** КРЕДИТЫ – СОЗДАНИЕ ****************/
    case "credit_name": {
      stateObj.name = text;
      stateObj.state = "credit_total";
      saveUserState(userId, stateObj);
      bot.sendMessage(chatId, "Введите полную сумму кредита:");
      break;
    }

    case "credit_total": {
      const total = parseAmount(text);
      if (total == null || total <= 0) {
        return bot.sendMessage(chatId, "Введите корректную полную сумму кредита.");
      }
      stateObj.total = total;
      stateObj.state = "credit_percent";
      saveUserState(userId, stateObj);
      bot.sendMessage(chatId, "Введите процент по кредиту (годовой, просто число):");
      break;
    }

    case "credit_percent": {
      const percent = parseAmount(text) ?? 0;
      stateObj.percent = percent;
      stateObj.state = "credit_monthly";
      saveUserState(userId, stateObj);
      bot.sendMessage(chatId, "Введите плановый ежемесячный платёж:");
      break;
    }

    case "credit_monthly": {
      const monthly = parseAmount(text);
      if (monthly == null || monthly <= 0) {
        return bot.sendMessage(chatId, "Введите корректный ежемесячный платёж.");
      }
      stateObj.monthly = monthly;
      stateObj.state = "credit_day";
      saveUserState(userId, stateObj);
      bot.sendMessage(chatId, "Введите день платежа (1–31):");
      break;
    }

    case "credit_day": {
      const day = Number(text);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        return bot.sendMessage(chatId, "Введите число от 1 до 31.");
      }

      addCredit(
        db,
        userId,
        stateObj.name,
        stateObj.total,
        stateObj.percent,
        day,
        stateObj.monthly,
        () => {
          clearUserState(userId);
          bot.sendMessage(
            chatId,
            "Кредит добавлен! ✔ Напоминания включены.",
            getMainMenuKeyboard(userId)
          );
        }
      );
      break;
    }

    /**************** КРЕДИТЫ – ОПЛАТА ****************/
    case "credit_payment_amount": {
      const amount = parseAmount(text);
      if (amount == null || amount <= 0) {
        return bot.sendMessage(chatId, "Введите корректную сумму платежа.");
      }

      updateCreditPaid(db, stateObj.creditId, amount, () => {
        // сохраняем как расход
        saveTransaction(
          db,
          userId,
          "expense",
          "Кредит",
          amount,
          CREDIT_CATEGORY_NAME,
          "Платёж по кредиту",
          true,
          stateObj.creditId,
          ""
        );

        clearUserState(userId);
        bot.sendMessage(
          chatId,
          "Платёж по кредиту сохранён ✅",
          getMainMenuKeyboard(userId)
        );
      });
      break;
    }

    default:
      clearUserState(userId);
      bot.sendMessage(chatId, "Состояние сброшено.", getMainMenuKeyboard(userId));
  }
}
