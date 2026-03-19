// Background service worker - handles Gemini API calls

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

async function getApiKey() {
  const result = await chrome.storage.local.get("geminiApiKey");
  return result.geminiApiKey || null;
}

async function analyzeSentiment(comments, apiKey, retryCount = 0) {
  const prompt = `Kamu adalah analis sentimen komentar YouTube. Analisis setiap komentar berikut dan berikan hasilnya dalam format JSON.

Untuk setiap komentar, tentukan:
- "sentiment": "positif", "negatif", atau "netral"
- "score": angka dari -1.0 (sangat negatif) sampai 1.0 (sangat positif)
- "alasan": penjelasan singkat dalam bahasa Indonesia (maks 10 kata)

Lalu berikan juga:
- "ringkasan": ringkasan keseluruhan sentimen dalam 1-2 kalimat bahasa Indonesia
- "statistik": {"positif": jumlah, "negatif": jumlah, "netral": jumlah}

Daftar komentar:
${comments.map((c, i) => `${i + 1}. "${c}"`).join("\n")}

Jawab HANYA dalam JSON valid:
{
  "hasil": [
    {"komentar": "teks", "sentiment": "positif/negatif/netral", "score": 0.0, "alasan": "..."}
  ],
  "ringkasan": "...",
  "statistik": {"positif": 0, "negatif": 0, "netral": 0}
}`;

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 16384,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `Gemini API error (${response.status}): ${errorData.error?.message || response.statusText}`
    );
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("Tidak ada respons dari Gemini API");
  }

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  let jsonStr = jsonMatch[1].trim();

  // Clean control characters inside JSON string values that break JSON.parse
  jsonStr = jsonStr.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, " ");

  try {
    return JSON.parse(jsonStr);
  } catch (parseError) {
    // Retry up to 2 times if JSON is truncated/invalid
    if (retryCount < 2) {
      console.warn(
        `JSON parse gagal (percobaan ${retryCount + 1}), retry...`,
        parseError.message
      );
      await new Promise((r) => setTimeout(r, 1000 * (retryCount + 1)));
      return analyzeSentiment(comments, apiKey, retryCount + 1);
    }
    throw new Error(
      `${jsonStr.substring(0, 80)}... is not valid JSON`
    );
  }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "analyzeSentiment") {
    (async () => {
      try {
        const apiKey = await getApiKey();
        if (!apiKey) {
          sendResponse({
            success: false,
            error:
              "API Key belum diatur. Silakan masukkan Gemini API Key di pengaturan.",
          });
          return;
        }

        // Process in batches of 20 to avoid token limits
        const batchSize = 20;
        const comments = request.comments;
        const allResults = [];
        let totalStats = { positif: 0, negatif: 0, netral: 0 };
        const totalBatches = Math.ceil(comments.length / batchSize);

        for (let i = 0; i < comments.length; i += batchSize) {
          const batchNum = Math.floor(i / batchSize) + 1;
          const batch = comments.slice(i, i + batchSize);

          // Send progress update to popup
          chrome.runtime.sendMessage({
            action: "batchProgress",
            current: batchNum,
            total: totalBatches,
            processed: Math.min(i + batchSize, comments.length),
            totalComments: comments.length,
          }).catch(() => {});

          const result = await analyzeSentiment(batch, apiKey);

          allResults.push(...result.hasil);
          totalStats.positif += result.statistik.positif;
          totalStats.negatif += result.statistik.negatif;
          totalStats.netral += result.statistik.netral;
        }

        // Generate concise summary from overall stats
        const total = totalStats.positif + totalStats.negatif + totalStats.netral;
        const dominan = totalStats.positif >= totalStats.negatif && totalStats.positif >= totalStats.netral
          ? "positif" : totalStats.negatif >= totalStats.positif && totalStats.negatif >= totalStats.netral
          ? "negatif" : "netral";
        const pctDominan = total > 0 ? Math.round((totalStats[dominan] / total) * 100) : 0;
        const ringkasan = `Dari ${total} komentar yang dianalisis, sentimen didominasi oleh komentar ${dominan} (${pctDominan}%) dengan ${totalStats.positif} positif, ${totalStats.netral} netral, dan ${totalStats.negatif} negatif.`;

        sendResponse({
          success: true,
          data: {
            hasil: allResults,
            ringkasan: ringkasan,
            statistik: totalStats,
          },
        });
      } catch (error) {
        sendResponse({
          success: false,
          error: error.message,
        });
      }
    })();
    return true; // Keep channel open for async
  }

  if (request.action === "saveApiKey") {
    chrome.storage.local.set({ geminiApiKey: request.apiKey }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "getApiKey") {
    getApiKey().then((key) => {
      sendResponse({ apiKey: key });
    });
    return true;
  }
});
