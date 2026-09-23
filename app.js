const analyze = document.querySelector('#analyzeBtn');
const aiPanel = document.querySelector('#aiPanel');
const result = document.querySelector('#resultPanel');
const toast = document.querySelector('#toast');

analyze.addEventListener('click', () => {
  aiPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

document.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => {
  chip.parentElement.querySelectorAll('.chip').forEach((item) => item.classList.remove('active'));
  chip.classList.add('active');
}));

document.querySelector('#makeBriefBtn').addEventListener('click', () => {
  result.classList.remove('hidden');
  result.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

document.querySelector('#publishBtn').addEventListener('click', () => {
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
});

document.querySelectorAll('.apply').forEach((button) => button.addEventListener('click', () => {
  button.textContent = 'Отклик отправлен ✓';
  button.style.color = '#18a976';
}));
