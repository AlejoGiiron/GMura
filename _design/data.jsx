// Mock data para G-Mura POS

const CATEGORIES = [
  { id: 'all', name: 'Todo', count: 142 },
  { id: 'camisetas', name: 'Camisetas', count: 38 },
  { id: 'pantalones', name: 'Pantalones', count: 24 },
  { id: 'vestidos', name: 'Vestidos', count: 19 },
  { id: 'accesorios', name: 'Accesorios', count: 31 },
  { id: 'calzado', name: 'Calzado', count: 18 },
  { id: 'chaquetas', name: 'Chaquetas', count: 12 },
];

// Stock por talla — null/0 = agotado
const PRODUCTS = [
  {
    id: 'p1',
    name: 'Camiseta Básica',
    brand: 'G-Mura Essentials',
    category: 'camisetas',
    price: 35000,
    swatch: '#f5f5f0',
    img: 'linear-gradient(135deg, #fafaf7 0%, #ebebe4 100%)',
    sizes: { XS: 4, S: 8, M: 5, L: 0, XL: 3 },
    colors: ['#f5f5f0', '#1a1a1a', '#9ca3af'],
  },
  {
    id: 'p2',
    name: 'Jeans Slim Fit',
    brand: 'Denim Co.',
    category: 'pantalones',
    price: 89000,
    swatch: '#1a1a1a',
    img: 'linear-gradient(135deg, #2a2a2e 0%, #131316 100%)',
    sizes: { 28: 2, 30: 6, 32: 4, 34: 0, 36: 1 },
    colors: ['#1a1a1a', '#2d3748', '#5a6478'],
  },
  {
    id: 'p3',
    name: 'Vestido Floral',
    brand: 'Bloom Studio',
    category: 'vestidos',
    price: 65000,
    swatch: '#e8d5e0',
    img: 'linear-gradient(135deg, #f4e4ed 0%, #d9b8cc 60%, #8b6f7d 100%)',
    sizes: { XS: 3, S: 5, M: 2, L: 0 },
    colors: ['#e8d5e0', '#d4a5a5', '#6b5b73'],
  },
  {
    id: 'p4',
    name: 'Cinturón Café',
    brand: 'G-Mura Leather',
    category: 'accesorios',
    price: 28000,
    swatch: '#6b4423',
    img: 'linear-gradient(135deg, #8b5a2b 0%, #5c3a1c 100%)',
    sizes: { 'Única': 12 },
    colors: ['#6b4423', '#1a1a1a', '#3d2914'],
  },
  {
    id: 'p5',
    name: 'Camisa Lino Crudo',
    brand: 'Atelier Norte',
    category: 'camisetas',
    price: 78000,
    swatch: '#e8dcc4',
    img: 'linear-gradient(135deg, #f0e6d2 0%, #d4c5a3 100%)',
    sizes: { S: 4, M: 7, L: 3, XL: 2 },
    colors: ['#e8dcc4', '#fff', '#8b7355'],
  },
  {
    id: 'p6',
    name: 'Pantalón Wide Leg',
    brand: 'Bloom Studio',
    category: 'pantalones',
    price: 95000,
    swatch: '#3a3a3a',
    img: 'linear-gradient(135deg, #4a4a4a 0%, #1f1f1f 100%)',
    sizes: { 26: 1, 28: 4, 30: 5, 32: 2, 34: 0 },
    colors: ['#3a3a3a', '#5d4e3a', '#1a1a1a'],
  },
  {
    id: 'p7',
    name: 'Sneaker Blanco',
    brand: 'Walk Co.',
    category: 'calzado',
    price: 145000,
    swatch: '#fafafa',
    img: 'linear-gradient(135deg, #ffffff 0%, #e8e8e8 100%)',
    sizes: { 36: 2, 37: 3, 38: 4, 39: 5, 40: 2, 41: 1 },
    colors: ['#fafafa', '#1a1a1a'],
  },
  {
    id: 'p8',
    name: 'Bufanda Lana',
    brand: 'G-Mura Essentials',
    category: 'accesorios',
    price: 42000,
    swatch: '#8b6f47',
    img: 'linear-gradient(135deg, #a08660 0%, #6b5638 100%)',
    sizes: { 'Única': 8 },
    colors: ['#8b6f47', '#3a3a3a', '#c4a988'],
  },
  {
    id: 'p9',
    name: 'Chaqueta Bomber',
    brand: 'Atelier Norte',
    category: 'chaquetas',
    price: 189000,
    swatch: '#2d3a2d',
    img: 'linear-gradient(135deg, #3d4a3d 0%, #1a221a 100%)',
    sizes: { S: 1, M: 3, L: 2, XL: 0 },
    colors: ['#2d3a2d', '#1a1a1a', '#5a4a3a'],
  },
];

// Util — formato COP
const fmtCOP = (n) => '$' + Math.round(n).toLocaleString('es-CO').replace(/,/g, '.');

// Tallas presentación: orden estable
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Única', '26', '28', '30', '32', '34', '36', '37', '38', '39', '40', '41', '42'];
const orderedSizes = (sizes) =>
  Object.keys(sizes).sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b));

Object.assign(window, { CATEGORIES, PRODUCTS, fmtCOP, orderedSizes });
