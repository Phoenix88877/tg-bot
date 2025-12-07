// analytics.js
require("dotenv").config();
const axios = require("axios");

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Вызов Llama
async function askLlama(prompt) {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY не задан в .env");

  const resp = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
    }
  );

  return resp.data.choices[0].message.content;
}

// AI-анализ расходов по транзакциям
async function analyzeExpenses(db, getAllTransactionsFn, ownerId, isFamily) {
  const rows = await new Promise((resolve) =>
    getAllTransactionsFn(db, isFamily ? null : ownerId, resolve)
  );

  if (!rows.length) {
    return "Пока нет данных по расходам, чтобы что-то анализировать 🤷‍♂️";
  }

  let income = 0;
  let expense = 0;
  const byCategory = {};

  rows.forEach((r) => {
    const amt = Number(r.amount);
    if (r.type === "income") income += amt;
    if (r.type === "expense") {
      expense += amt;
      const cat = r.category || "Прочее";
      byCategory[cat] = (byCategory[cat] || 0) + amt;
    }
  });

  const sortedCats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  let statsText = `Доход: ${income.toFixed(2)}\nРасход: ${expense.toFixed(
    2
  )}\n\nРасходы по категориям:\n`;

  sortedCats.forEach(([cat, val]) => {
    const perc = income > 0 ? ((val / income) * 100).toFixed(1) : "–";
    statsText += `• ${cat}: ${val.toFixed(2)} (${perc}% от дохода)\n`;
  });

  const systemPrompt =
    "Ты финансовый аналитик. На основе статистики расходов и доходов сделай краткий, понятный и конкретный анализ, без воды. В конце дай 3–5 практичных советов по оптимизации расходов. Пиши по-русски, структурированно, с эмодзи по желанию.";

  const fullPrompt = `${systemPrompt}\n\nДАННЫЕ:\n${statsText}`;

  const aiText = await askLlama(fullPrompt);
  return aiText;
}

module.exports = {
  askLlama,
  analyzeExpenses,
};
