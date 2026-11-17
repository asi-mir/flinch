'use strict';
// Demo shop for Flinch. The usability problems here are deliberate:
//   1. A newsletter popup with a tiny close button appears while you browse.
//   2. "Tomorrow" delivery hides behind a small "other options" link.
//   3. The phone field wants one exact format and the error does not say which.
//   4. A failed check clears the email field.
//   5. A service fee appears only on the last screen.
//   6. "Pay now" takes four seconds and gives no sign that it is working.

const PRODUCTS = [
  { id: 'blue', name: 'Blue mug', price: 18, color: '#3b6fb6' },
  { id: 'sand', name: 'Sand mug', price: 18, color: '#c9b08a' },
  { id: 'moss', name: 'Moss mug', price: 21, color: '#6b8f5e' },
  { id: 'coal', name: 'Coal mug', price: 21, color: '#3a3a3a' },
];
const basket = [];
let order = null;

const $ = (id) => document.getElementById(id);
const money = (n) => `$${n.toFixed(2)}`;

function show(page) {
  for (const id of ['shop', 'checkout', 'pay', 'done']) $(id).hidden = id !== page;
  if (location.hash !== `#${page}`) history.pushState(null, '', `#${page}`);
  window.scrollTo(0, 0);
}

function renderProducts() {
  $('products').replaceChildren(
    ...PRODUCTS.map((p) => {
      const card = document.createElement('article');
      card.className = 'product';
      const swatch = document.createElement('div');
      swatch.className = 'mug';
      swatch.style.background = p.color;
      const name = document.createElement('h2');
      name.textContent = p.name;
      const price = document.createElement('p');
      price.textContent = money(p.price);
      const add = document.createElement('button');
      add.textContent = 'Add to basket';
      add.addEventListener('click', () => {
        basket.push(p);
        $('basket-count').textContent = basket.length;
        add.textContent = 'Added';
        setTimeout(() => (add.textContent = 'Add to basket'), 1200);
      });
      card.append(swatch, name, price, add);
      return card;
    }),
  );
}

function fail(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
  $('email').value = ''; // problem 4
}

$('details').addEventListener('submit', (e) => {
  e.preventDefault();
  $('form-error').hidden = true;
  const data = Object.fromEntries(new FormData(e.target));
  if (!basket.length) return fail('Your basket is empty.');
  if (!data.name.trim() || !data.email.includes('@')) return fail('Please check your details.');
  if (!/^\+\d{2} \d{3} \d{3} \d{4}$/.test(data.phone)) return fail('Invalid input.'); // problem 3
  if (!/^\d{5}$/.test(data.postcode)) return fail('Invalid input.');
  const items = basket.reduce((sum, p) => sum + p.price, 0);
  const delivery = data.delivery === 'tomorrow' ? 6 : 0;
  order = { items, delivery, fee: 4.9, how: data.delivery };
  const rows = [
    [`${basket.length} mug${basket.length === 1 ? '' : 's'}`, items],
    ['Delivery', delivery],
    ['Service fee', order.fee], // problem 5
    ['Total', items + delivery + order.fee],
  ];
  $('bill').replaceChildren(
    ...rows.map(([label, value]) => {
      const tr = document.createElement('tr');
      const a = document.createElement('td');
      const b = document.createElement('td');
      a.textContent = label;
      b.textContent = money(value);
      tr.append(a, b);
      return tr;
    }),
  );
  show('pay');
});

$('more-delivery').addEventListener('click', (e) => {
  e.preventDefault();
  $('extra-delivery').hidden = false;
});

$('pay-button').addEventListener('click', () => {
  setTimeout(() => {
    const when = order.how === 'tomorrow' ? 'tomorrow' : order.how === 'pickup' ? 'when you pick it up' : 'in 5 to 8 working days';
    $('done-text').textContent = `Thank you. Your order arrives ${when}.`;
    show('done');
  }, 4000); // problem 6
});

$('basket-link').addEventListener('click', (e) => {
  e.preventDefault();
  $('basket-summary').textContent = basket.length ? `In your basket: ${basket.map((p) => p.name).join(', ')}.` : 'Your basket is empty.';
  show('checkout');
});
document.querySelector('.brand').addEventListener('click', (e) => {
  e.preventDefault();
  show('shop');
});

// Problem 1.
setTimeout(() => {
  if (!$('shop').hidden) $('popup').hidden = false;
}, 5000);
$('popup-close').addEventListener('click', () => ($('popup').hidden = true));
$('popup-join').addEventListener('click', () => ($('popup').hidden = true));

window.addEventListener('popstate', () => {
  const page = location.hash.slice(1);
  for (const id of ['shop', 'checkout', 'pay', 'done']) $(id).hidden = id !== (page || 'shop');
});

renderProducts();
