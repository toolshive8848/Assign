// ==========================
// Prompt Engineer Frontend JS
// ==========================

document.addEventListener("DOMContentLoaded", () => {
  const originalPrompt = document.getElementById("original-prompt");
  const analyzeBtn = document.getElementById("analyze-btn");
  const optimizeBtn = document.getElementById("optimize-btn");
  const copyBtn = document.getElementById("copy-btn");
  const downloadBtn = document.getElementById("download-btn");
  const openHistoryBtn = document.getElementById("open-history-btn");
  const historyModal = document.getElementById("history-modal");
  const closeModalBtn = document.getElementById("close-modal-btn");
  const optimizedPromptArea = document.getElementById("optimized-prompt");

  let selectedCategory = "general";

  // ============ Event Bindings ============
  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", () => {
      const prompt = originalPrompt.value.trim();
      if (!prompt) return alert("Please enter a prompt first.");
      analyzePromptWithCredits(prompt);
    });
  }

  if (optimizeBtn) {
    optimizeBtn.addEventListener("click", () => {
      const prompt = originalPrompt.value.trim();
      if (!prompt) return alert("Please enter a prompt first.");
      optimizePrompt(prompt, selectedCategory);
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const text = optimizedPromptArea.value.trim();
      if (!text) return alert("No optimized prompt to copy.");
      navigator.clipboard.writeText(text);
      alert("✅ Optimized prompt copied!");
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      const text = optimizedPromptArea.value.trim();
      if (!text) return alert("No optimized prompt to download.");
      const blob = new Blob([text], { type: "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "optimized_prompt.txt";
      link.click();
    });
  }

  if (openHistoryBtn) {
    openHistoryBtn.addEventListener("click", async () => {
      await loadPromptHistory();
      historyModal.style.display = "flex";
    });
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener("click", () => {
      historyModal.style.display = "none";
    });
  }

  // Category selection
  document.querySelectorAll(".btn-sm").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-sm").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedCategory = btn.textContent.toLowerCase();
    });
  });

  // Load initial recent optimizations
  loadRecentOptimizations();
});

// ============ API Helpers ============
async function makeAuthenticatedRequest(url, options = {}) {
  const token = localStorage.getItem("token");
  if (!token) throw new Error("User not authenticated");
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

// ============ Analysis ============
async function analyzePromptWithCredits(prompt) {
  try {
    const res = await makeAuthenticatedRequest("/api/prompt/analyze", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (!data.success) return alert("❌ Analysis failed: " + data.error);

    updateQualityMetrics(data.analysis);
    updateCreditsDisplay();
  } catch (err) {
    console.error("Analyze error:", err);
    alert("❌ Failed to analyze prompt.");
  }
}

// ============ Optimization ============
async function optimizePrompt(prompt, category) {
  try {
    showLoading("Optimizing your prompt...");
    const res = await makeAuthenticatedRequest("/api/prompt/optimize", {
      method: "POST",
      body: JSON.stringify({ prompt, category }),
    });
    const data = await res.json();
    hideLoading();

    if (!data.success) return alert("❌ Optimization failed: " + data.error);

    displayOptimizedPrompt(data);
    updateCreditsDisplay();
    loadRecentOptimizations(); // refresh after new optimization
  } catch (err) {
    hideLoading();
    console.error("Optimize error:", err);
    alert("❌ Failed to optimize prompt.");
  }
}

// ============ History ============
async function loadPromptHistory() {
  try {
    const res = await makeAuthenticatedRequest("/api/prompt/history");
    const data = await res.json();
    if (!data.success) return;

    const historyList = document.querySelector("#history-modal .project-list");
    historyList.innerHTML = "";

    if (data.history && data.history.length > 0) {
      data.history.forEach((item) => {
        const li = document.createElement("li");
        li.className = "project-item";
        li.innerHTML = `
          <div>
            <h4>${item.title || "Untitled Prompt"}</h4>
            <p class="text-sm text-gray">${new Date(item.createdAt).toLocaleDateString()} • ${item.category || "General"}</p>
          </div>
          <button class="btn btn-outline" onclick="loadHistoryItem('${item.id}')">Open</button>
        `;
        historyList.appendChild(li);
      });
    } else {
      historyList.innerHTML = "<li class='project-item'><p>No history found.</p></li>";
    }
  } catch (err) {
    console.error("History error:", err);
  }
}

async function loadHistoryItem(id) {
  try {
    const res = await makeAuthenticatedRequest(`/api/prompt/history/${id}`);
    const data = await res.json();
    if (!data.success) return alert("❌ Failed to load item.");

    document.getElementById("original-prompt").value = data.prompt || "";
    document.getElementById("optimized-prompt").value = data.optimizedPrompt || "";
    updateQualityMetrics(data.analysis || {});
    document.getElementById("history-modal").style.display = "none";
  } catch (err) {
    console.error("Load history item error:", err);
  }
}

// ============ Recent Optimizations ============
async function loadRecentOptimizations() {
  try {
    const res = await makeAuthenticatedRequest("/api/prompt/history");
    const data = await res.json();
    if (!data.success) return;

    const container = document.getElementById("recent-optimizations");
    container.innerHTML = "";

    if (data.history && data.history.length > 0) {
      data.history.slice(0, 5).forEach((item) => {
        const div = document.createElement("div");
        div.className = "optimization-example";
        div.innerHTML = `
          <h5>${item.title || "Untitled Prompt"}</h5>
          <p class="text-sm text-gray">${item.optimizedPrompt?.substring(0, 100) || "No optimized text"}...</p>
          <p class="text-xs text-gray">${new Date(item.createdAt).toLocaleString()}</p>
        `;
        container.appendChild(div);
      });
    } else {
      container.innerHTML = `
        <div class="optimization-example">
          <p class="text-sm text-gray">No recent optimizations yet.</p>
        </div>
      `;
    }
  } catch (err) {
    console.error("Recent optimizations error:", err);
  }
}

// ============ UI Updates ============
function updateQualityMetrics(analysis) {
  const clarity = analysis.clarity?.score || 0;
  const specificity = analysis.specificity?.score || 0;
  const context = analysis.context?.score || 0;
  const overall = analysis.overall?.score || 0;

  document.getElementById("clarity-score").textContent = clarity + "%";
  document.getElementById("clarity-progress").style.width = clarity + "%";

  document.getElementById("specificity-score").textContent = specificity + "%";
  document.getElementById("specificity-progress").style.width = specificity + "%";

  document.getElementById("context-score").textContent = context + "%";
  document.getElementById("context-progress").style.width = context + "%";

  document.getElementById("overall-score").textContent = overall + "%";
  document.getElementById("overall-progress").style.width = overall + "%";
}

function displayOptimizedPrompt(data) {
  document.getElementById("optimized-prompt").value = data.optimizedPrompt || "";
  if (data.improvements?.length) {
    alert("✨ Improvements made:\n- " + data.improvements.join("\n- "));
  }
}

async function updateCreditsDisplay() {
  try {
    const res = await makeAuthenticatedRequest("/api/prompt/credits");
    const data = await res.json();
    if (data.success) {
      const creditsElement = document.querySelector(".user-credits span");
      if (creditsElement) {
        const remaining = data.total - data.used;
        creditsElement.textContent = `${remaining}/${data.total} Credits`;
      }
    }
  } catch (err) {
    console.error("Credits update error:", err);
  }
}

// ============ Loading Overlay ============
function showLoading(msg) {
  const div = document.createElement("div");
  div.id = "loading-indicator";
  div.innerHTML = `
    <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;">
      <div style="background:white;padding:20px;border-radius:8px;">⏳ ${msg}</div>
    </div>
  `;
  document.body.appendChild(div);
}

function hideLoading() {
  const div = document.getElementById("loading-indicator");
  if (div) div.remove();
}
