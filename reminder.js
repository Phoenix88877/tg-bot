// reminder.js

/************************************************************
 * Напоминания о платеже по кредитам
 * Каждые 15 минут проверяем:
 *  - если уже после 09:00
 *  - если ещё не отправляли сегодня
 *  - ищем кредиты с pay_day == сегодняшнее число
 *  - присылаем владельцу (OWNER_MAIN) список
 ************************************************************/
function initReminders(bot, db, getCreditsDueToday, mainOwnerId) {
  let lastNotifiedDate = null; // 'YYYY-MM-DD'

  setInterval(() => {
    const now = new Date();
    const todayDate = now.toISOString().slice(0, 10);
    const dayOfMonth = now.getDate();

    // Чтоб не спамить — 1 раз в день
    if (lastNotifiedDate === todayDate) return;

    // Отправляем напоминание после 9 утра (по времени сервера)
    if (now.getHours() < 9) return;

    getCreditsDueToday(db, dayOfMonth, (credits) => {
      if (!credits || !credits.length) return;

      lastNotifiedDate = todayDate;

      let text = "📅 *Сегодня день платежа по кредитам:*\n\n";

      credits.forEach((c) => {
        const remaining = Math.max(0, (c.total || 0) - (c.paid || 0));
        text +=
          `• *${c.name}*\n` +
          `  Полная сумма: ${c.total}\n` +
          `  Выплачено: ${c.paid}\n` +
          `  Остаток: ${remaining}\n` +
          `  Ежемесячный платёж: ${c.monthly_payment}\n` +
          `  День платежа: ${c.pay_day}\n\n`;
      });

      bot.sendMessage(mainOwnerId, text, { parse_mode: "Markdown" });
    });
  }, 15 * 60 * 1000); // каждые 15 минут
}

module.exports = {
  initReminders
};
