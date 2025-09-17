// ===== Mobile Menu Toggle =====
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("mobile-menu-toggle");
  const menu = document.getElementById("nav-links");
  const overlay = document.getElementById("menu-overlay");

  if (!toggle || !menu || !overlay) return;

  // Toggle open/close
  toggle.addEventListener("click", () => {
    toggle.classList.toggle("active");
    menu.classList.toggle("active");
    overlay.classList.toggle("active");
  });

  // Close menu when clicking on overlay
  overlay.addEventListener("click", () => {
    toggle.classList.remove("active");
    menu.classList.remove("active");
    overlay.classList.remove("active");
  });

  // Close menu when a nav link is clicked
  const navLinks = menu.querySelectorAll("a");
  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      toggle.classList.remove("active");
      menu.classList.remove("active");
      overlay.classList.remove("active");
    });
  });
});
