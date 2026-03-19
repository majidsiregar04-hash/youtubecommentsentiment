// Popup script - handles UI and orchestrates scraping + analysis

document.addEventListener("DOMContentLoaded", () => {
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsPanel = document.getElementById("settingsPanel");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const saveKeyBtn = document.getElementById("saveKeyBtn");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const maxCommentsSelect = document.getElementById("maxComments");
  const statusDiv = document.getElementById("status");
  const loadingDiv = document.getElementById("loading");
  const loadingText = document.getElementById("loadingText");
  const resultsDiv = document.getElementById("results");

  let sentimentChart = null;
  let lastAnalysisData = null;
  let lastVideoTitle = "";
  let lastCommentCount = 0;

  // Listen for batch progress updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "batchProgress") {
      loadingText.textContent = message.status ||
        `Menganalisis batch ${message.current}/${message.total} (${message.processed}/${message.totalComments} komentar)...`;
    }
  });

  // Load saved API key
  chrome.runtime.sendMessage({ action: "getApiKey" }, (response) => {
    if (response?.apiKey) {
      apiKeyInput.value = response.apiKey;
    }
  });

  // Toggle settings
  settingsBtn.addEventListener("click", () => {
    settingsPanel.classList.toggle("hidden");
  });

  // Save API key
  saveKeyBtn.addEventListener("click", () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus("Masukkan API Key terlebih dahulu", "error");
      return;
    }
    chrome.runtime.sendMessage(
      { action: "saveApiKey", apiKey: key },
      (response) => {
        if (response?.success) {
          showStatus("API Key berhasil disimpan!", "success");
          settingsPanel.classList.add("hidden");
        }
      }
    );
  });

  // Analyze button
  analyzeBtn.addEventListener("click", startAnalysis);

  // PDF download button
  document.getElementById("downloadPdfBtn").addEventListener("click", generatePdf);

  async function startAnalysis() {
    const maxComments = parseInt(maxCommentsSelect.value);

    // Reset UI
    resultsDiv.classList.add("hidden");
    statusDiv.classList.add("hidden");
    loadingDiv.classList.remove("hidden");
    analyzeBtn.disabled = true;
    loadingText.textContent = "Mengambil komentar dari halaman...";

    try {
      // Step 1: Get active tab
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.url?.includes("youtube.com/watch")) {
        throw new Error(
          "Buka halaman video YouTube terlebih dahulu sebelum menganalisis."
        );
      }

      // Step 2: Scrape comments (maxComments=0 means all)
      loadingText.textContent =
        maxComments === 0
          ? "Memuat semua komentar (scroll otomatis)..."
          : `Memuat ${maxComments} komentar...`;

      const scrapeResult = await sendMessageToTab(tab.id, {
        action: "scrapeComments",
        maxComments: maxComments,
      });

      if (!scrapeResult?.success || scrapeResult.comments.length === 0) {
        throw new Error(
          scrapeResult?.message ||
            "Gagal mengambil komentar. Scroll halaman ke bawah dulu agar komentar muncul, lalu coba lagi."
        );
      }

      showStatus(
        `${scrapeResult.comments.length} komentar ditemukan. Menganalisis sentimen...`,
        "info"
      );
      loadingText.textContent = "Menganalisis sentimen dengan Gemini AI...";

      // Step 3: Analyze sentiment
      const analysisResult = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            action: "analyzeSentiment",
            comments: scrapeResult.comments,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (!response?.success) {
              reject(new Error(response?.error || "Analisis gagal"));
            } else {
              resolve(response.data);
            }
          }
        );
      });

      // Step 4: Display results
      displayResults(
        analysisResult,
        scrapeResult.videoTitle,
        scrapeResult.comments.length
      );
    } catch (error) {
      showStatus(error.message, "error");
    } finally {
      loadingDiv.classList.add("hidden");
      analyzeBtn.disabled = false;
    }
  }

  function sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  function displayResults(data, videoTitle, commentCount) {
    statusDiv.classList.add("hidden");
    resultsDiv.classList.remove("hidden");

    // Video info
    document.getElementById("videoTitle").textContent = videoTitle;
    document.getElementById("commentCount").textContent =
      `${commentCount} komentar dianalisis`;

    const stats = data.statistik;
    const total = stats.positif + stats.negatif + stats.netral;

    // Stat bars
    updateStatBar("Positif", stats.positif, total);
    updateStatBar("Netral", stats.netral, total);
    updateStatBar("Negatif", stats.negatif, total);

    // Chart
    renderChart(stats);

    // Summary & themes
    document.getElementById("summaryText").textContent = data.ringkasan;

    const themeSections = document.getElementById("themeSections");
    if (data.tema_positif || data.tema_netral || data.tema_negatif) {
      themeSections.classList.remove("hidden");
      document.getElementById("themePositif").textContent = data.tema_positif || "-";
      document.getElementById("themeNetral").textContent = data.tema_netral || "-";
      document.getElementById("themeNegatif").textContent = data.tema_negatif || "-";
    } else {
      themeSections.classList.add("hidden");
    }

    // Store for PDF export
    lastAnalysisData = data;
    lastVideoTitle = videoTitle;
    lastCommentCount = commentCount;

    // Comment list grouped by sentiment
    const commentList = document.getElementById("commentList");
    commentList.innerHTML = "";

    const groups = [
      { key: "positif", label: "😊 Positif", items: [] },
      { key: "netral", label: "😐 Netral", items: [] },
      { key: "negatif", label: "😞 Negatif", items: [] },
    ];

    data.hasil.forEach((item) => {
      const group = groups.find((g) => g.key === item.sentiment);
      if (group) group.items.push(item);
    });

    groups.forEach((group) => {
      if (group.items.length === 0) return;

      const header = document.createElement("h4");
      header.className = `comment-group-header ${group.key}`;
      header.textContent = `${group.label} (${group.items.length})`;
      commentList.appendChild(header);

      group.items.forEach((item) => {
        const div = document.createElement("div");
        div.className = `comment-item ${item.sentiment}`;
        div.innerHTML = `
          <div class="comment-text">${escapeHtml(item.komentar)}</div>
          <div class="comment-meta">
            <span class="comment-reason">${escapeHtml(item.alasan || "")}</span>
          </div>
        `;
        commentList.appendChild(div);
      });
    });
  }

  function updateStatBar(label, count, total) {
    const id = label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
    const barEl = document.getElementById(`bar${id}`);
    const countEl = document.getElementById(`count${id}`);

    if (barEl && countEl) {
      const pct = total > 0 ? (count / total) * 100 : 0;
      barEl.style.width = `${pct}%`;
      countEl.textContent = count;
    }
  }

  function renderChart(stats) {
    const ctx = document.getElementById("sentimentChart").getContext("2d");

    if (sentimentChart) {
      sentimentChart.destroy();
    }

    sentimentChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Positif", "Netral", "Negatif"],
        datasets: [
          {
            data: [stats.positif, stats.netral, stats.negatif],
            backgroundColor: ["#22c55e", "#eab308", "#ef4444"],
            borderColor: ["#166534", "#854d0e", "#991b1b"],
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: {
              color: "#aaa",
              font: { size: 11 },
              padding: 12,
            },
          },
        },
        cutout: "60%",
      },
    });
  }

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.classList.remove("hidden");
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function generatePdf() {
    if (!lastAnalysisData) return;

    const data = lastAnalysisData;
    const stats = data.statistik;
    const total = stats.positif + stats.negatif + stats.netral;

    // Group comments
    const grouped = { positif: [], netral: [], negatif: [] };
    data.hasil.forEach((item) => {
      if (grouped[item.sentiment]) grouped[item.sentiment].push(item);
    });

    // Build HTML for PDF
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Analisis Sentimen - ${lastVideoTitle}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #222; }
  h1 { font-size: 18px; color: #c00; border-bottom: 2px solid #c00; padding-bottom: 8px; }
  h2 { font-size: 15px; margin-top: 20px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 16px; }
  .stats { display: flex; gap: 20px; margin: 12px 0; }
  .stat { padding: 10px 16px; border-radius: 8px; font-weight: bold; font-size: 14px; }
  .stat.positif { background: #dcfce7; color: #166534; }
  .stat.netral { background: #fef9c3; color: #854d0e; }
  .stat.negatif { background: #fee2e2; color: #991b1b; }
  .summary { background: #f8f9fa; padding: 12px; border-radius: 8px; margin: 12px 0; font-size: 13px; line-height: 1.6; }
  .theme { margin: 4px 0; }
  .theme strong { font-size: 13px; }
  .group-title { font-size: 14px; margin-top: 16px; padding: 6px 0; border-bottom: 1px solid #ddd; }
  .group-title.positif { color: #166534; }
  .group-title.netral { color: #854d0e; }
  .group-title.negatif { color: #991b1b; }
  .comment { padding: 6px 0; border-bottom: 1px solid #eee; font-size: 12px; }
  .comment .text { color: #333; }
  .comment .reason { color: #888; font-style: italic; font-size: 11px; }
  @media print { body { padding: 10px; } }
</style>
</head><body>
<h1>Analisis Sentimen Komentar YouTube</h1>
<div class="meta"><strong>${lastVideoTitle}</strong><br>${lastCommentCount} komentar dianalisis</div>

<div class="stats">
  <div class="stat positif">Positif: ${stats.positif} (${total > 0 ? Math.round(stats.positif / total * 100) : 0}%)</div>
  <div class="stat netral">Netral: ${stats.netral} (${total > 0 ? Math.round(stats.netral / total * 100) : 0}%)</div>
  <div class="stat negatif">Negatif: ${stats.negatif} (${total > 0 ? Math.round(stats.negatif / total * 100) : 0}%)</div>
</div>

<h2>Ringkasan</h2>
<div class="summary">
  <p>${data.ringkasan}</p>
  ${data.tema_positif ? `<div class="theme"><strong>Positif:</strong> ${data.tema_positif}</div>` : ""}
  ${data.tema_netral ? `<div class="theme"><strong>Netral:</strong> ${data.tema_netral}</div>` : ""}
  ${data.tema_negatif ? `<div class="theme"><strong>Negatif:</strong> ${data.tema_negatif}</div>` : ""}
</div>

<h2>Detail Komentar</h2>
${["positif", "netral", "negatif"].map((s) => {
  if (grouped[s].length === 0) return "";
  const label = s === "positif" ? "Positif" : s === "netral" ? "Netral" : "Negatif";
  return `<div class="group-title ${s}">${label} (${grouped[s].length})</div>
${grouped[s].map((c) => `<div class="comment"><div class="text">${c.komentar}</div><div class="reason">${c.alasan || ""}</div></div>`).join("")}`;
}).join("")}

</body></html>`;

    // Open in new tab for print/save as PDF
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    chrome.tabs.create({ url });
  }
});
