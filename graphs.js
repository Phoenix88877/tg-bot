// graphs.js
const { createCanvas } = require("canvas");
const Chart = require("chart.js/auto");

// График доходов/расходов по месяцам (12 месяцев максимум)
function generateIncomeExpenseChart(db, getAllTransactionsFn, ownerId, isFamily) {
  return new Promise((resolve, reject) => {
    getAllTransactionsFn(db, isFamily ? null : ownerId, (rows) => {
      if (!rows || !rows.length) {
        return reject(new Error("Нет данных для построения графика."));
      }

      // Группа: YYYY-MM -> { income, expense }
      const map = new Map();

      rows.forEach((r) => {
        const d = new Date(r.date_str || r.datetime);
        if (isNaN(d)) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
          2,
          "0"
        )}`;
        if (!map.has(key)) map.set(key, { income: 0, expense: 0 });
        const item = map.get(key);
        const amt = Number(r.amount);
        if (r.type === "income") item.income += amt;
        if (r.type === "expense") item.expense += amt;
      });

      const sortedKeys = Array.from(map.keys()).sort();
      const limitedKeys = sortedKeys.slice(-12); // последние 12 месяцев

      const labels = [];
      const incomeData = [];
      const expenseData = [];

      limitedKeys.forEach((k) => {
        labels.push(k);
        incomeData.push(map.get(k).income);
        expenseData.push(map.get(k).expense);
      });

      const width = 900;
      const height = 500;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      new Chart.Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "Доходы",
              data: incomeData,
            },
            {
              label: "Расходы",
              data: expenseData,
            },
          ],
        },
        options: {
          responsive: false,
          plugins: {
            title: {
              display: true,
              text: "Доходы и расходы по месяцам",
            },
            legend: {
              position: "top",
            },
          },
        },
      });

      canvas.toBuffer((err, buf) => {
        if (err) return reject(err);
        resolve(buf);
      });
    });
  });
}

module.exports = {
  generateIncomeExpenseChart,
};
