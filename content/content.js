// Content script - scrapes YouTube comments from the DOM

(function () {
  "use strict";

  function extractComments() {
    const commentElements = document.querySelectorAll(
      "ytd-comment-thread-renderer #content-text"
    );

    const comments = [];
    commentElements.forEach((el) => {
      const text = el.innerText.trim();
      if (text) {
        comments.push(text);
      }
    });

    return comments;
  }

  function getVideoTitle() {
    const titleEl =
      document.querySelector(
        "yt-formatted-string.style-scope.ytd-watch-metadata"
      ) || document.querySelector("h1.ytd-watch-metadata yt-formatted-string");
    return titleEl ? titleEl.innerText.trim() : "Unknown Video";
  }

  function scrollToLoadComments(maxScrolls = 5) {
    return new Promise((resolve) => {
      let scrollCount = 0;
      const commentsSection = document.querySelector("ytd-comments#comments");

      if (!commentsSection) {
        resolve(false);
        return;
      }

      const interval = setInterval(() => {
        window.scrollBy(0, 800);
        scrollCount++;

        if (scrollCount >= maxScrolls) {
          clearInterval(interval);
          // Wait for comments to render
          setTimeout(() => resolve(true), 2000);
        }
      }, 1000);
    });
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === "scrapeComments") {
      const maxComments = request.maxComments || 50;

      // First check if comments are already loaded
      let comments = extractComments();

      if (comments.length === 0) {
        // Scroll down to load comments
        scrollToLoadComments(request.scrollAttempts || 5).then((scrolled) => {
          if (scrolled) {
            comments = extractComments();
          }

          sendResponse({
            success: comments.length > 0,
            comments: comments.slice(0, maxComments),
            videoTitle: getVideoTitle(),
            totalFound: comments.length,
            message:
              comments.length > 0
                ? `Berhasil mengambil ${Math.min(comments.length, maxComments)} komentar`
                : "Tidak ada komentar ditemukan. Pastikan Anda berada di halaman video YouTube dan komentar sudah dimuat.",
          });
        });
        return true; // Keep message channel open for async response
      }

      sendResponse({
        success: true,
        comments: comments.slice(0, maxComments),
        videoTitle: getVideoTitle(),
        totalFound: comments.length,
        message: `Berhasil mengambil ${Math.min(comments.length, maxComments)} komentar`,
      });
    }

    return true;
  });
})();
