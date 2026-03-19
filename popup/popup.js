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

  // Listen for batch progress updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "batchProgress") {
      loadingText.textContent =
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

    // Summary
    document.getElementById("summaryText").textContent = data.ringkasan;

    // Comment list
    const commentList = document.getElementById("commentList");
    commentList.innerHTML = "";

    data.hasil.forEach((item) => {
      const div = document.createElement("div");
      div.className = `comment-item ${item.sentiment}`;

      const emoji =
        item.sentiment === "positif"
          ? "😊"
          : item.sentiment === "negatif"
            ? "😞"
            : "😐";

      div.innerHTML = `
        <div class="comment-text">${escapeHtml(item.komentar)}</div>
        <div class="comment-meta">
          <span class="sentiment-badge ${item.sentiment}">${emoji} ${item.sentiment}</span>
          <span class="comment-reason">${escapeHtml(item.alasan || "")}</span>
        </div>
      `;
      commentList.appendChild(div);
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
});
