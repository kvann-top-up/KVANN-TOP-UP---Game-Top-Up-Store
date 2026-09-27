const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalText = document.getElementById("modalText");
const playerId = document.getElementById("playerId");
const toast = document.getElementById("toast");

function openModal(game = "TOP UP") {
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  modalTitle.textContent = `${game.toUpperCase()} TOP UP`;
  modalText.textContent = `បញ្ចូល Player ID របស់អ្នកសម្រាប់ ${game}.`;
  playerId.value = "";
  setTimeout(() => playerId.focus(), 100);
}

function closeModal() {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

document.querySelectorAll(".topup-btn").forEach(btn => {
  btn.addEventListener("click", () => openModal(btn.dataset.game));
});

document.getElementById("quickTopup").addEventListener("click", () => openModal());
document.getElementById("closeModal").addEventListener("click", closeModal);
document.getElementById("supportBtn").addEventListener("click", () => {
  showToast("សូមទាក់ទង KVANN TOP UP Support ដើម្បីទទួលបានជំនួយ 24/7.");
});
document.getElementById("loginBtn").addEventListener("click", () => {
  showToast("Login system អាចភ្ជាប់ជាមួយ backend របស់អ្នកបាននៅពេលក្រោយ។");
});
document.getElementById("searchBtn").addEventListener("click", () => {
  showToast("Search feature ready — អ្នកអាចភ្ជាប់វាជាមួយ game/product database បាន។");
});
document.getElementById("continueBtn").addEventListener("click", () => {
  if (!playerId.value.trim()) {
    showToast("សូមបញ្ចូល Player ID ជាមុនសិន។");
    playerId.focus();
    return;
  }
  showToast(`បានទទួល Player ID: ${playerId.value.trim()}. បន្ទាប់មកភ្ជាប់ payment/order API នៅទីនេះ។`);
});

modal.addEventListener("click", e => {
  if (e.target === modal) closeModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
});

const menuBtn = document.getElementById("menuBtn");
const navLinks = document.getElementById("navLinks");
menuBtn.addEventListener("click", () => navLinks.classList.toggle("open"));
document.querySelectorAll(".nav-links a").forEach(a => {
  a.addEventListener("click", () => navLinks.classList.remove("open"));
});

const sections = [...document.querySelectorAll("main section[id]")];
const navAnchors = [...document.querySelectorAll(".nav-links a")];
window.addEventListener("scroll", () => {
  const y = window.scrollY + 120;
  let current = "home";
  sections.forEach(s => { if (y >= s.offsetTop) current = s.id; });
  navAnchors.forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + current));
}, {passive:true});

document.getElementById("year").textContent = new Date().getFullYear();



// Game cards: click any of the 3 games to open its matching price list.
const gameSections = {
  freefire: document.getElementById('freefire-products'),
  mlbb: document.getElementById('mlbb-products'),
  pubg: document.getElementById('pubg-products')
};

document.querySelectorAll('.game-card').forEach(card => {
  const key = [...card.classList].find(c => gameSections[c]);
  if (!key) return;
  card.style.cursor = 'pointer';
  const open = (event) => {
    if (event.target.closest('.topup-btn')) event.preventDefault();
    gameSections[key]?.scrollIntoView({behavior:'smooth', block:'start'});
  };
  card.addEventListener('click', open);
  card.querySelector('.topup-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    gameSections[key]?.scrollIntoView({behavior:'smooth', block:'start'});
  });
});

// Independent cart/selection logic for each game.
document.querySelectorAll('.game-product').forEach(section => {
  let selected = null;
  let discount = 0;

  const items = section.querySelectorAll('.item-card');
  const selectedItem = section.querySelector('.selected-item');
  const totalPrice = section.querySelector('.total-price');
  const playerId = section.querySelector('.game-player-id');
  const couponInput = section.querySelector('.coupon-input');
  const applyCoupon = section.querySelector('.apply-coupon');
  const buyNow = section.querySelector('.buy-now');

  const update = () => {
    const total = selected ? Math.max(0, selected.price - discount) : 0;
    selectedItem.textContent = selected ? selected.name : '[—]';
    totalPrice.textContent = `[$${total.toFixed(2)}]`;
    buyNow.disabled = !selected;
  };

  items.forEach(item => {
    item.addEventListener('click', () => {
      items.forEach(x => x.classList.remove('selected'));
      item.classList.add('selected');
      selected = {name:item.dataset.name, price:Number(item.dataset.price)};
      discount = 0;
      update();
    });
  });

  applyCoupon?.addEventListener('click', () => {
    const code = couponInput.value.trim().toUpperCase();
    if (!selected) return showToast('សូមជ្រើសរើស Item ជាមុនសិន។');
    if (code === 'KVANN10') {
      discount = selected.price * .10;
      update();
      showToast('Coupon KVANN10 បានអនុវត្ត — បញ្ចុះតម្លៃ 10%។');
    } else {
      discount = 0;
      update();
      showToast('Coupon មិនត្រឹមត្រូវ ឬផុតកំណត់។');
    }
  });

  buyNow?.addEventListener('click', () => {
    const uid = playerId.value.trim();
    if (!uid) {
      showToast(`សូមបញ្ចូល ${section.dataset.game} Player ID ជាមុនសិន។`);
      playerId.focus();
      return;
    }
    showToast(`បានជ្រើស ${selected.name} សម្រាប់ ${section.dataset.game} — Player ID ${uid}.`);
  });
});
