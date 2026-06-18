export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return res.status(500).json({ ok: false, error: "Telegram is not configured" });
  }

  const body = req.body || {};
  const projectName = clean(body.projectName || "Bez názvu projektu");
  const cardTitle = clean(body.cardTitle || "Bez názvu karty");
  const email = clean(body.email || "Neznámý uživatel");
  const text = clean(body.text || "");
  const url = clean(body.url || "");

  const message = [
    "Komentář",
    "",
    `Projekt: ${projectName}`,
    "",
    `Karta: ${cardTitle}`,
    "",
    "Komentář:",
    text || "(bez textu)",
    "",
    `Přidal: ${email}`,
    "",
    url ? `Otevřít: ${url}` : ""
  ].filter(Boolean).join("\n");

  const tgResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true
    })
  });

  const result = await tgResponse.json();

  if (!tgResponse.ok) {
    return res.status(500).json({ ok: false, error: result });
  }

  return res.status(200).json({ ok: true });
}

function clean(value) {
  return String(value).slice(0, 3500);
}
