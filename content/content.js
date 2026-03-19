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

  function scrollToLoadComments(maxComments) {
    return new Promise((resolve) => {
      const commentsSection = document.querySelector("ytd-comments#comments");

      if (!commentsSection) {
        resolve(false);
        return;
      }

      let previousCount = 0;
      let stableRounds = 0;
      const maxStableRounds = 3; // Stop after 3 rounds with no new comments

      const interval = setInterval(() => {
        const currentCount = document.querySelectorAll(
          "ytd-comment-thread-renderer #content-text"
        ).length;

        // If we have enough comments (when not loading all), stop
        if (maxComments > 0 && currentCount >= maxComments) {
          clearInterval(interval);
          setTimeout(() => resolve(true), 1500);
          return;
        }

        // Check if new comments were loaded
        if (currentCount === previousCount) {
          stableRounds++;
        } else {
          stableRounds = 0;
        }

        previousCount = currentCount;

        // If no new comments after several rounds, we've reached the end
        if (stableRounds >= maxStableRounds) {
          clearInterval(interval);
          setTimeout(() => resolve(true), 1500);
          return;
        }

        // Scroll down to trigger loading more comments
        window.scrollBy(0, 1500);
      }, 1500);
    });
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === "scrapeComments") {
      // maxComments: 0 means load all
      const maxComments = request.maxComments || 0;

      // Always scroll to load comments
      scrollToLoadComments(maxComments).then(() => {
        let comments = extractComments();
        const finalComments =
          maxComments > 0 ? comments.slice(0, maxComments) : comments;

        sendResponse({
          success: finalComments.length > 0,
          comments: finalComments,
          videoTitle: getVideoTitle(),
          totalFound: comments.length,
          message:
            finalComments.length > 0
              ? `Berhasil mengambil ${finalComments.length} komentar`
              : "Tidak ada komentar ditemukan. Pastikan Anda berada di halaman video YouTube dan komentar sudah dimuat.",
        });
      });
      return true; // Keep message channel open for async response
    }

    return true;
  });
})();
