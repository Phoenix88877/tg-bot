// reminder.js

/**
 * Инициализация напоминаний по кредитам
 * @param {TelegramBot} bot
 * @param {sqlite3.Database} db
 * @param {Function} getAllCredits - функция (db, cb) → cb(credits[])
 * @param {number} ownerMainId - твой Telegram ID (главный)
 */
function initReminders(bot, db, getAllCredits, ownerMainId) {
  const CHECK_INTERVAL_MS = 60 * 60 * 1000; // раз в час

  const TABLE_CREDITS = "Credits";

  function getNextPaymentDate(paymentDay) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const candidate = new Date(year, month, paymentDay);

    if (candidate < now) {
      return new Date(year, month + 1, paymentDay).toISOString().split("T")[0];
    }
    return candidate.toISOString().split("T")[0];
  }

  function updateNextPaymentDate(creditId, paymentDay) {
    const nextDate = getNextPaymentDate(paymentDay);
    db.run(
      `UPDATE ${TABLE_CREDITS} SET next_payment_date = ? WHERE id = ?`,
      [nextDate, creditId]
    );
  }

  function checkCredits() {
    getAllCredits(db, (credits) => {
      if (!credits || !credits.length) return;

      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const startOfToday = new Date(todayStr + "T00:00:00Z");

      credits.forEach((c) => {
        if (!c.payment_day) return;

        // если даты нет — создаём и обновляем
        if (!c.next_payment_date) {
          const fixed = getNextPaymentDate(c.payment_day);
          db.run(
            `UPDATE ${TABLE_CREDITS} SET next_payment_date = ? WHERE id = ?`,
            [fixed, c.id]
          );
          c.next_payment_date = fixed;
        }

        const due = new Date(c.next_payment_date + "T00:00:00Z");
        const diffMs = due.getTime() - startOfToday.getTime();
        const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

        let msg = null;

        if (diffDays === 3) {
          msg = `🔔 Через 3 дня платёж по кредиту *${c.name}* (${c.amount.toLocaleString()} сум).`;
        } else if (diffDays === 1) {
          msg = `🔔 Завтра платёж по кредиту *${c.name}* (${c.amount.toLocaleString()} сум).`;
        } else if (diffDays === 0) {
          msg = `🚨 Сегодня платёж по кредиту *${c.name}*!`;
        } else if (diffDays < -1) {
          // дата сильно в прошлом — сдвигаем на следующий месяц
          updateNextPaymentDate(c.id, c.payment_day);
        }

        if (msg) {
          bot.sendMessage(ownerMainId, msg, { parse_mode: "Markdown" });
        }
      });
    });
  }

  // Запускаем цикл
  setInterval(checkCredits, CHECK_INTERVAL_MS);
  // И сразу при старте
  checkCredits();

  console.log("⏰ Напоминания по кредитам запущены");
}

module.exports = { initReminders };
