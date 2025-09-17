// mobile-menu.js
// Handles mobile navigation toggle with smooth slide-in/out

document.addEventListener("DOMContentLoaded", () => {
  const toggleBtn = document.getElementById("mobile-menu-toggle");
  const navMenu = document.querySelector(".nav-links");

  if (toggleBtn && navMenu) {
    toggleBtn.addEventListener("click", () => {
      const expanded = toggleBtn.getAttribute("aria-expanded") === "true" || false;
      toggleBtn.setAttribute("aria-expanded", !expanded);
      navMenu.classList.toggle("active");
    });
  }

  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    if (
      navMenu.classList.contains("active") &&
      !navMenu.contains(e.target) &&
      !toggleBtn.contains(e.target)
    ) {
      navMenu.classList.remove("active");
      toggleBtn.setAttribute("aria-expanded", false);
    }
  });
});
