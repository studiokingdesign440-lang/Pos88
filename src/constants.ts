import { Product, Settings, ThemeId } from './types';

export const STORE_KEY = 'hokkien88_pos_v3';

export const THEME_OPTIONS: { id: ThemeId; name: string; subtitle: string; swatches: [string, string, string] }[] = [
  {
    id: 'original',
    name: 'Hokkien 88 Original',
    subtitle: 'Warm ivory & crimson kitchen palette',
    swatches: ['#F6F2EA', '#FFFFFF', '#A8201A'],
  },
  {
    id: 'hacker',
    name: 'Hacker Terminal',
    subtitle: 'Dark phosphor matrix console UI',
    swatches: ['#060B08', '#0D1711', '#00E676'],
  },
  {
    id: 'retro',
    name: 'Retro Game',
    subtitle: '16-bit arcade cabinet & pixel headers',
    swatches: ['#141126', '#1F1A3A', '#FACC15'],
  },
  {
    id: 'terminal',
    name: 'Old School Terminal',
    subtitle: '1980s Amber CRT mainframe screen',
    swatches: ['#120B03', '#1C1206', '#FFB000'],
  },
];

export const DEFAULT_SETTINGS: Settings = {
  storeName: 'Hokkien 88',
  tagline: 'Chinese · Indonesian Kitchen',
  address: 'Jl. Merdeka No. 88, Medan',
  phone: '0812-3456-7888',
  footerText: 'Thank you for dining with us',
  cashierNames: [
    'Handsome Man on The Cashier',
    'Owner Son',
    'Prince Charming',
    'The Chosen One',
    'Young Boss',
    'Captain Coffee',
  ],
  thanks: ['Thank you!', 'Xie xie!', 'Mauliate!', 'Terima kasih!', 'Kamsia!', 'See you again!'],
  quotes: [
    '"May the Force be with you." — Star Wars',
    '"I\'ll be back." — The Terminator',
    '"To infinity and beyond!" — Toy Story',
  ],
  taxPercent: 0,
  servicePercent: 0,
  paperWidth: 58,
  printMethod: 'bluetooth',
  cutPaper: true,
  gasUrl: '',
  lastCashier: '',
  timezone: 'Asia/Jakarta',
  theme: 'original',
};

export const DEFAULT_PRODUCTS: Product[] = [
  { id: 'p_nasgor_daging', main: 'Nasi Goreng', name: 'Nasi Goreng Daging', price: 28000, active: true },
];

export const QUICK_EXPENSES = ['Rice', 'Gas', 'Vegetables', 'Meat', 'Electricity', 'Water', 'Snacks'];

export const ORDER_SHORTCUTS = [
  'Takeaway',
  'Meja 1',
  'Meja 2',
  'Meja 3',
  'Meja 4',
  'Meja 5',
  'Meja 6',
  'Meja 7',
  'Meja Luar',
  'Delivery',
];
