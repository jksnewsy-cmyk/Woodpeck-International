// Links the original Woodpeck home page with the full store / checkout flow.
const url = (route) => import.meta.env.BASE_URL + 'store.html#/' + route;
document.querySelectorAll('.desktop-nav a, .mobile-menu a').forEach((a) => {
  if (a.getAttribute('href') === '#featured') {
    a.href = url('shop');
    a.textContent = 'All Furniture';
  }
});
const heroLink = document.querySelector('.hero-content .btn');
if (heroLink) heroLink.href = url('shop');

document.querySelectorAll('#seeBestSellers').forEach((button) => {
  // Existing "Best sellers" interactions still work on homepage.
  button.title = 'See best-selling items';
});
document.addEventListener('click', (event) => {
  const match = event.target.closest('[data-view],[data-category],#cartHeader,#cartMobile,#wishlistHeader,#wishlistMobile,#accountBtn,#accountMobile,#checkoutBtn');
  if (!match) return;
  let path;
  if (match.dataset.view) path = 'product/' + encodeURIComponent(match.dataset.view);
  else if (match.dataset.category) path = 'shop/' + encodeURIComponent(match.dataset.category);
  else if (match.id === 'cartHeader' || match.id === 'cartMobile') path = 'cart';
  else if (match.id === 'wishlistHeader' || match.id === 'wishlistMobile') path = 'wishlist';
  else if (match.id === 'accountBtn' || match.id === 'accountMobile') path = 'account';
  else if (match.id === 'checkoutBtn') path = 'address';
  if (!path) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.location.href = url(path);
}, true);

document.querySelectorAll('.mobile-bottom-nav a[href="#categories"]').forEach((a) => {
  a.href = url('shop');
});
