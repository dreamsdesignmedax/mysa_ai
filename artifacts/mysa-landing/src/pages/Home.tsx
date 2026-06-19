import React, { useState, useEffect } from "react";

const APP_URL = "/v1";

const GOOGLE_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" style="flex-shrink:0"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`;

const MS_SVG = `<svg viewBox="0 0 22 22" width="16" height="16" style="flex-shrink:0"><rect fill="#F35325" x="0" y="0" width="10" height="10"/><rect fill="#81BC06" x="11" y="0" width="10" height="10"/><rect fill="#05A6F0" x="0" y="11" width="10" height="10"/><rect fill="#FFBA08" x="11" y="11" width="10" height="10"/></svg>`;

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }

  .lp { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: #FAFAFA; color: #111827; overflow-x: hidden;
        -webkit-font-smoothing: antialiased; line-height: 1.6; }
  .lp ::-webkit-scrollbar { width: 4px; }
  .lp ::-webkit-scrollbar-thumb { background: #7C3AED; border-radius: 2px; }

  /* ── NAV ── */
  .lp-nav {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 60px; height: 64px;
    background: rgba(255,255,255,0.97); backdrop-filter: blur(20px);
    border-bottom: 1px solid #E9E7F3; transition: box-shadow 0.3s; gap: 24px;
  }
  .lp-nav.scrolled { box-shadow: 0 2px 24px rgba(109,40,217,0.09); }
  .lp-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; flex-shrink: 0; }
  .lp-logo-icon {
    width: 36px; height: 36px; border-radius: 12px;
    background: linear-gradient(135deg, #2D1B69, #7C3AED);
    display: flex; align-items: center; justify-content: center;
    color: white; font-size: 16px; flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(124,58,237,0.35);
  }
  .lp-logo-text { font-size: 18px; font-weight: 700; color: #111827; letter-spacing: -0.025em; }
  .lp-nav-links { display: flex; gap: 28px; list-style: none; }
  .lp-nav-links a { color: #6B7280; font-size: 14px; font-weight: 500; text-decoration: none; transition: color 0.2s; }
  .lp-nav-links a:hover { color: #111827; }
  .lp-nav-right { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
  .lp-nav-signin { color: #374151; font-size: 14px; font-weight: 600; text-decoration: none; padding: 8px 14px; border-radius: 10px; transition: background 0.2s; white-space: nowrap; }
  .lp-nav-signin:hover { background: #F5F3FF; color: #6D28D9; }
  .lp-nav-cta {
    background: linear-gradient(135deg, #2D1B69, #7C3AED); color: white;
    padding: 9px 20px; border-radius: 10px; font-size: 14px; font-weight: 700;
    text-decoration: none; transition: all 0.2s; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 6px;
    box-shadow: 0 2px 8px rgba(124,58,237,0.3);
  }
  .lp-nav-cta:hover { box-shadow: 0 4px 18px rgba(124,58,237,0.48); transform: translateY(-1px); }
  .lp-menu-btn { display: none; background: none; border: none; color: #111827; cursor: pointer; font-size: 22px; flex-shrink: 0; }

  /* ── MOBILE NAV ── */
  .lp-mobile-nav { display: none; position: fixed; inset: 0; z-index: 200; background: white; flex-direction: column; padding: 24px; }
  .lp-mobile-nav.open { display: flex; }
  .lp-mobile-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 36px; }
  .lp-mobile-links { display: flex; flex-direction: column; gap: 0; }
  .lp-mobile-links a { color: #111827; font-size: 17px; font-weight: 600; text-decoration: none; padding: 14px 0; border-bottom: 1px solid #F3F4F6; }
  .lp-mobile-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 28px; }

  /* ── HERO ── */
  .lp-hero {
    min-height: 100vh; padding-top: 64px; display: flex; align-items: stretch;
    background: linear-gradient(150deg, #050210 0%, #0D0425 25%, #1E0A3C 55%, #2D1B69 80%, #4C1D95 100%);
    position: relative; overflow: hidden;
  }
  .lp-hero::before {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background:
      radial-gradient(ellipse 900px 700px at 10% 80%, rgba(167,139,250,0.14) 0%, transparent 60%),
      radial-gradient(ellipse 700px 600px at 90% 15%, rgba(124,58,237,0.18) 0%, transparent 60%),
      radial-gradient(ellipse 500px 400px at 55% 55%, rgba(109,40,217,0.08) 0%, transparent 70%);
  }
  .lp-hero::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background-image: radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px);
    background-size: 32px 32px;
  }
  .lp-hero-inner {
    position: relative; z-index: 1; max-width: 860px; margin: 0 auto;
    padding: 90px 40px 110px; display: flex; flex-direction: column;
    align-items: center; text-align: center; width: 100%;
  }
  .lp-hero-badge {
    display: inline-flex; align-items: center; gap: 8px;
    background: rgba(255,255,255,0.07); border: 1px solid rgba(196,181,253,0.22);
    padding: 6px 18px 6px 10px; border-radius: 100px;
    font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.65);
    margin-bottom: 32px; backdrop-filter: blur(10px);
  }
  .lp-badge-dot { width: 7px; height: 7px; border-radius: 50%; background: #A78BFA; animation: lp-pulse 2s infinite; }
  @keyframes lp-pulse { 0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(167,139,250,0.5)} 50%{opacity:0.6;box-shadow:0 0 0 8px rgba(167,139,250,0)} }
  .lp-hero h1 {
    font-size: clamp(38px, 4.8vw, 64px); font-weight: 800;
    line-height: 1.12; letter-spacing: -0.025em;
    color: white; margin-bottom: 20px; max-width: 820px;
  }
  .lp-hero h1 span { color: #C4B5FD; text-shadow: 0 0 60px rgba(167,139,250,0.5); }
  .lp-hero-sub {
    font-size: 16px; color: rgba(255,255,255,0.55);
    line-height: 1.7; max-width: 500px; margin-bottom: 48px; font-weight: 400;
  }
  .lp-hero-sub strong { color: rgba(255,255,255,0.85); font-weight: 600; }

  /* ── HERO FORM ── */
  .lp-hero-form { width: 100%; max-width: 520px; margin-bottom: 52px; }
  .lp-form-row {
    display: flex; gap: 0; margin-bottom: 14px;
    border-radius: 14px; overflow: hidden;
    box-shadow: 0 4px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.08);
  }
  .lp-form-input {
    flex: 1; padding: 14px 20px; font-size: 14px; font-family: inherit;
    border: none; outline: none; background: rgba(255,255,255,0.97); color: #111827;
    border-radius: 14px 0 0 14px; min-width: 0;
  }
  .lp-form-input::placeholder { color: #9CA3AF; }
  .lp-form-btn {
    padding: 14px 22px; background: linear-gradient(135deg, #5B21B6, #7C3AED);
    color: white; font-size: 14px; font-weight: 700; font-family: inherit;
    border: none; cursor: pointer; white-space: nowrap;
    border-radius: 0 14px 14px 0; transition: all 0.2s;
  }
  .lp-form-btn:hover { background: linear-gradient(135deg, #4C1D95, #6D28D9); }
  .lp-form-or {
    display: flex; align-items: center; gap: 12px; margin-bottom: 12px;
    color: rgba(255,255,255,0.3); font-size: 13px;
  }
  .lp-form-or::before, .lp-form-or::after {
    content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.1);
  }
  .lp-form-socials { display: flex; gap: 10px; margin-bottom: 16px; }
  .lp-form-social {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;
    padding: 11px 16px; background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12); border-radius: 12px;
    color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 600;
    text-decoration: none; transition: all 0.2s; cursor: pointer; backdrop-filter: blur(8px);
  }
  .lp-form-social:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.22); }
  .lp-form-note { font-size: 11px; color: rgba(255,255,255,0.28); text-align: center; }
  .lp-form-note a { color: rgba(167,139,250,0.6); }

  /* ── HERO METRICS ── */
  .lp-hero-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; width: 100%; max-width: 500px; }
  .lp-metric-card {
    border-radius: 16px; padding: 18px 14px;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(196,181,253,0.15);
    text-align: center; backdrop-filter: blur(14px);
  }
  .lp-metric-num { font-size: 26px; font-weight: 900; color: white; letter-spacing: -0.025em; line-height: 1; }
  .lp-metric-label { font-size: 11px; margin-top: 5px; color: rgba(167,139,250,0.65); font-weight: 500; }

  /* ── TICKER ── */
  .lp-ticker { background: white; border-bottom: 1px solid #E9E7F3; padding: 11px 0; overflow: hidden; white-space: nowrap; }
  .lp-ticker-inner { display: inline-flex; animation: lp-ticker 32s linear infinite; }
  @keyframes lp-ticker { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
  .lp-ticker-item { display: inline-flex; align-items: center; gap: 8px; padding: 0 30px; font-size: 12px; font-weight: 500; color: #9CA3AF; border-right: 1px solid #F3F4F6; }
  .lp-ticker-item span { color: #6D28D9; font-weight: 700; }
  .lp-ticker-dot { width: 4px; height: 4px; border-radius: 50%; background: #A78BFA; }

  /* ── COMMON SECTION ── */
  .lp-section { padding: 96px 60px; max-width: 1280px; margin: 0 auto; }
  .lp-eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
    color: #6D28D9; margin-bottom: 16px;
  }
  .lp-eyebrow::before { content: ''; width: 20px; height: 2px; background: linear-gradient(90deg, #7C3AED, #A78BFA); border-radius: 1px; display: block; }
  .lp-h2 { font-size: clamp(28px, 3vw, 44px); font-weight: 800; line-height: 1.15; letter-spacing: -0.025em; color: #111827; margin-bottom: 16px; }
  .lp-h2 span { color: #2D1B69; }
  .lp-h2 em { color: #7C3AED; font-style: normal; }
  .lp-lead { font-size: 15px; color: #6B7280; line-height: 1.625; max-width: 580px; }
  .lp-lead strong { color: #111827; font-weight: 600; }

  /* ── PAIN — DARK BENTO GRID ── */
  .lp-pain-wrap {
    background: #09090B; padding: 96px 60px;
  }
  .lp-pain-header { text-align: center; margin-bottom: 56px; }
  .lp-pain-eyebrow {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
    color: #A78BFA; margin-bottom: 20px;
    background: rgba(167,139,250,0.12); border: 1px solid rgba(167,139,250,0.2);
    padding: 5px 14px; border-radius: 100px;
  }
  .lp-pain-h2 {
    font-size: clamp(32px, 4vw, 52px); font-weight: 800; line-height: 1.12;
    letter-spacing: -0.025em; color: white; margin-bottom: 16px;
  }
  .lp-pain-h2 span { color: #A78BFA; }
  .lp-pain-sub { font-size: 15px; color: rgba(255,255,255,0.4); max-width: 520px; margin: 0 auto; line-height: 1.7; }
  .lp-bento { max-width: 1160px; margin: 0 auto; display: grid; grid-template-columns: 3fr 2fr; grid-template-rows: auto auto; gap: 12px; }
  .lp-bento-big {
    grid-row: 1 / 3; background: #111116;
    border: 1px solid rgba(255,255,255,0.07); border-radius: 20px;
    padding: 40px; display: flex; flex-direction: column; justify-content: space-between;
    overflow: hidden; position: relative; min-height: 420px;
  }
  .lp-bento-big::before {
    content: ''; position: absolute; top: -80px; right: -80px;
    width: 300px; height: 300px; border-radius: 50%;
    background: radial-gradient(circle, rgba(109,40,217,0.15) 0%, transparent 70%);
    pointer-events: none;
  }
  .lp-bento-small {
    background: #111116; border: 1px solid rgba(255,255,255,0.07);
    border-radius: 20px; padding: 28px; position: relative; overflow: hidden;
    transition: border-color 0.25s;
  }
  .lp-bento-small:hover { border-color: rgba(167,139,250,0.3); }
  .lp-bento-full {
    grid-column: 1 / -1; background: linear-gradient(135deg, #0F0A2A, #1A0A3C, #2D1B69);
    border: 1px solid rgba(167,139,250,0.15); border-radius: 20px;
    padding: 40px 48px; display: flex; align-items: center; justify-content: space-between; gap: 40px;
    position: relative; overflow: hidden;
  }
  .lp-bento-full::after {
    content: ''; position: absolute; inset: 0;
    background-image: radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px);
    background-size: 28px 28px; pointer-events: none;
  }
  .lp-bento-tag {
    font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;
    padding: 4px 12px; border-radius: 100px; display: inline-flex; margin-bottom: 16px;
    background: rgba(167,139,250,0.15); color: #A78BFA; border: 1px solid rgba(167,139,250,0.2);
  }
  .lp-bento-title { font-size: 22px; font-weight: 800; color: white; line-height: 1.3; letter-spacing: -0.025em; margin-bottom: 12px; }
  .lp-bento-desc { font-size: 14px; color: rgba(255,255,255,0.45); line-height: 1.7; }
  .lp-bento-small .lp-bento-title { font-size: 16px; }
  .lp-bento-small .lp-bento-desc { font-size: 13px; }
  .lp-bento-visual {
    margin-top: 28px; background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 20px;
  }
  .lp-bento-invoice {
    font-size: 11px; color: rgba(255,255,255,0.35);
  }
  .lp-bento-invoice-row {
    display: flex; justify-content: space-between; padding: 7px 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .lp-bento-invoice-total {
    display: flex; justify-content: space-between; padding: 10px 0 0;
    font-size: 14px; font-weight: 700; color: rgba(255,255,255,0.2);
  }
  .lp-bento-invoice-total span:last-child { color: #EF4444; }
  .lp-bento-clock { font-size: 48px; font-weight: 900; color: rgba(167,139,250,0.3); letter-spacing: -0.05em; margin-top: 20px; line-height: 1; }
  .lp-bento-clock span { font-size: 14px; color: rgba(167,139,250,0.4); font-weight: 500; display: block; margin-top: 4px; letter-spacing: 0; }
  .lp-bento-full-text { position: relative; z-index: 1; max-width: 480px; }
  .lp-bento-full-text .lp-bento-title { font-size: 26px; }
  .lp-bento-full-text .lp-bento-desc { font-size: 15px; color: rgba(255,255,255,0.55); }
  .lp-bento-cta {
    display: inline-flex; align-items: center; gap: 8px;
    background: white; color: #1E0A3C; padding: 11px 20px;
    border-radius: 10px; font-size: 13px; font-weight: 700;
    text-decoration: none; margin-top: 20px; transition: all 0.2s; position: relative; z-index: 1;
  }
  .lp-bento-cta:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
  .lp-bento-chart { display: flex; align-items: flex-end; gap: 6px; height: 60px; margin-top: 20px; }
  .lp-bento-bar {
    flex: 1; border-radius: 4px 4px 0 0;
    background: rgba(167,139,250,0.15); position: relative; overflow: hidden;
  }
  .lp-bento-bar::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(to top, rgba(167,139,250,0.6), rgba(167,139,250,0.1)); border-radius: 4px 4px 0 0; }
  .lp-bento-full-visual {
    flex-shrink: 0; display: flex; flex-direction: column; gap: 8px;
    background: rgba(0,0,0,0.2); border-radius: 14px; padding: 16px; min-width: 260px;
    position: relative; z-index: 1;
  }
  .lp-bento-stat-row { display: flex; align-items: center; gap: 10px; }
  .lp-bento-stat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .lp-bento-stat-label { font-size: 12px; color: rgba(255,255,255,0.4); flex: 1; }
  .lp-bento-stat-val { font-size: 12px; font-weight: 700; }

  /* ── BELIEF ── */
  .lp-belief-wrap {
    background: linear-gradient(150deg, #0A0520 0%, #1E0A3C 45%, #2D1B69 100%);
    padding: 112px 60px; text-align: center; position: relative; overflow: hidden;
  }
  .lp-belief-wrap::before {
    content: '"'; position: absolute; top: -60px; left: 50%; transform: translateX(-50%);
    font-size: 500px; font-weight: 900; color: rgba(167,139,250,0.035);
    line-height: 1; pointer-events: none; font-family: Georgia, serif;
  }
  .lp-belief-wrap::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background:
      radial-gradient(ellipse 600px 400px at 15% 80%, rgba(167,139,250,0.09) 0%, transparent 70%),
      radial-gradient(ellipse 500px 350px at 85% 20%, rgba(124,58,237,0.11) 0%, transparent 70%);
  }
  .lp-belief-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #A78BFA; margin-bottom: 28px; position: relative; z-index: 1; }
  .lp-belief-quote { font-size: clamp(22px, 2.5vw, 34px); font-weight: 800; line-height: 1.4; color: white; max-width: 780px; margin: 0 auto 32px; position: relative; z-index: 1; letter-spacing: -0.025em; }
  .lp-belief-quote span { color: #A78BFA; }
  .lp-belief-line { width: 48px; height: 2px; background: rgba(167,139,250,0.3); margin: 0 auto 24px; border-radius: 1px; position: relative; z-index: 1; }
  .lp-belief-attr { font-size: 12px; color: rgba(255,255,255,0.3); letter-spacing: 1.5px; text-transform: uppercase; position: relative; z-index: 1; }
  .lp-belief-sub { font-size: 15px; color: rgba(255,255,255,0.5); max-width: 540px; margin: 28px auto 0; line-height: 1.75; position: relative; z-index: 1; }

  /* ── WHY ── */
  .lp-why-wrap { background: #F5F3FF; border-top: 1px solid #EDE9FE; border-bottom: 1px solid #EDE9FE; }
  .lp-why-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 56px; }
  .lp-why-card { background: white; border: 1px solid #EDE9FE; border-radius: 20px; overflow: hidden; transition: all 0.25s; box-shadow: 0 1px 4px rgba(109,40,217,0.04); }
  .lp-why-card:hover { border-color: #C4B5FD; box-shadow: 0 10px 36px rgba(109,40,217,0.1); transform: translateY(-4px); }
  .lp-why-card-header { padding: 20px 24px 16px; background: linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%); border-bottom: 1px solid #EDE9FE; }
  .lp-why-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; padding: 5px 12px; border-radius: 100px; background: linear-gradient(135deg, #2D1B69, #7C3AED); color: white; }
  .lp-why-card-body { padding: 20px 24px 24px; }
  .lp-why-card h3 { font-size: 16px; font-weight: 800; color: #111827; margin-bottom: 12px; line-height: 1.4; letter-spacing: -0.025em; }
  .lp-why-card p { font-size: 14px; color: #6B7280; line-height: 1.75; }

  /* ── HOW IT WORKS — LARGE STACKED CARDS ── */
  .lp-how-wrap { background: #09090B; padding: 96px 0; }
  .lp-how-header { text-align: center; padding: 0 60px; margin-bottom: 56px; }
  .lp-how-eyebrow {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
    color: #A78BFA; background: rgba(167,139,250,0.12); border: 1px solid rgba(167,139,250,0.2);
    padding: 5px 14px; border-radius: 100px; margin-bottom: 20px;
  }
  .lp-how-h2 { font-size: clamp(30px, 3.5vw, 48px); font-weight: 800; line-height: 1.15; letter-spacing: -0.025em; color: white; margin-bottom: 14px; }
  .lp-how-h2 em { color: #A78BFA; font-style: normal; }
  .lp-how-sub { font-size: 15px; color: rgba(255,255,255,0.4); max-width: 500px; margin: 0 auto; line-height: 1.7; }
  .lp-how-cards { display: flex; flex-direction: column; gap: 10px; max-width: 1160px; margin: 0 auto; padding: 0 60px; }
  .lp-how-step {
    display: grid; grid-template-columns: 1fr 380px; min-height: 180px;
    background: #111116; border: 1px solid rgba(255,255,255,0.07);
    border-radius: 20px; overflow: hidden; transition: border-color 0.25s;
  }
  .lp-how-step:hover { border-color: rgba(167,139,250,0.25); }
  .lp-how-step.result { grid-template-columns: 1fr 380px; background: linear-gradient(135deg, #0F0A2A, #1A0A3C); border-color: rgba(167,139,250,0.2); }
  .lp-how-step-left { padding: 32px 36px; display: flex; flex-direction: column; justify-content: center; }
  .lp-step-badge {
    display: inline-flex; align-items: center;
    font-size: 10px; font-weight: 900; letter-spacing: 2px;
    padding: 4px 12px; border-radius: 8px; margin-bottom: 14px; align-self: flex-start;
    background: rgba(167,139,250,0.12); color: #A78BFA; border: 1px solid rgba(167,139,250,0.18);
  }
  .lp-how-step.result .lp-step-badge { background: rgba(167,139,250,0.2); color: #C4B5FD; }
  .lp-how-step-h3 { font-size: 20px; font-weight: 800; color: white; letter-spacing: -0.025em; margin-bottom: 10px; line-height: 1.25; }
  .lp-how-step-p { font-size: 14px; color: rgba(255,255,255,0.42); line-height: 1.7; max-width: 420px; }
  .lp-how-step.result .lp-how-step-p { color: rgba(196,181,253,0.6); }
  .lp-how-step-right {
    display: flex; align-items: center; justify-content: center;
    font-size: 52px; position: relative; overflow: hidden;
  }
  .lp-how-step-right::before {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(135deg, rgba(109,40,217,0.2), rgba(167,139,250,0.12));
    border-left: 1px solid rgba(167,139,250,0.1);
  }
  .lp-how-step-icon { position: relative; z-index: 1; font-size: 56px; filter: drop-shadow(0 0 20px rgba(167,139,250,0.4)); }
  .lp-how-step-num-bg {
    position: absolute; bottom: -20px; right: -10px;
    font-size: 140px; font-weight: 900; color: rgba(167,139,250,0.06);
    line-height: 1; letter-spacing: -0.05em; pointer-events: none; z-index: 0;
  }
  .lp-how-step.result .lp-how-step-right::before { background: linear-gradient(135deg, rgba(76,29,149,0.4), rgba(45,27,105,0.3)); }

  /* ── FEATURES ── */
  .lp-feat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; margin-bottom: 80px; }
  .lp-feat-panel {
    background: white; border: 1px solid #EDE9FE;
    border-radius: 20px; overflow: hidden; box-shadow: 0 2px 12px rgba(109,40,217,0.06);
  }
  .lp-feat-panel-inner { padding: 20px; display: flex; flex-direction: column; gap: 10px; }
  .lp-panel-tag { font-size: 10px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #6D28D9; padding: 12px 16px; background: linear-gradient(135deg, #F5F3FF, #EDE9FE); border-bottom: 1px solid #EDE9FE; }
  .lp-chat-row { display: flex; gap: 10px; align-items: flex-start; background: #FAFAFA; border-radius: 12px; padding: 12px; border: 1px solid #EDE9FE; font-size: 13px; }
  .lp-chat-av { width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 13px; background: linear-gradient(135deg, #EDE9FE, #DDD6FE); }
  .lp-chat-tag { font-size: 9px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-bottom: 3px; background: #EDE9FE; color: #6D28D9; }
  .lp-chat-tag.user { background: #DDD6FE; color: #4C1D95; }
  .lp-chat-body { color: #111827; line-height: 1.6; }
  .lp-score-row { display: flex; align-items: center; gap: 12px; background: #FAFAFA; border: 1px solid #EDE9FE; border-radius: 12px; padding: 12px 14px; }
  .lp-score-bar { flex: 1; height: 4px; background: #EDE9FE; border-radius: 2px; overflow: hidden; margin-top: 4px; }
  .lp-score-fill { height: 100%; border-radius: 2px; background: linear-gradient(90deg, #2D1B69, #7C3AED, #A78BFA); }
  .lp-score-num { font-size: 26px; font-weight: 900; color: #6D28D9; line-height: 1; letter-spacing: -0.025em; }
  .lp-score-label { font-size: 11px; color: #9CA3AF; }
  .lp-feat-list { display: flex; flex-direction: column; gap: 10px; margin-top: 24px; }
  .lp-fi { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; background: white; border-radius: 12px; border: 1px solid #EDE9FE; transition: all 0.2s; }
  .lp-fi:hover { border-color: #C4B5FD; box-shadow: 0 2px 8px rgba(109,40,217,0.06); }
  .lp-fi-dot { width: 20px; height: 20px; border-radius: 6px; flex-shrink: 0; background: linear-gradient(135deg, #EDE9FE, #DDD6FE); display: flex; align-items: center; justify-content: center; font-size: 10px; color: #6D28D9; font-weight: 900; }
  .lp-fi-main { font-size: 13px; font-weight: 600; color: #111827; }
  .lp-fi-sub { font-size: 12px; color: #9CA3AF; margin-top: 1px; }
  .lp-stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .lp-stat-box { background: #FAFAFA; border: 1px solid #EDE9FE; border-radius: 12px; padding: 16px; text-align: center; }
  .lp-stat-box.dark { background: linear-gradient(135deg, #1E0A3C, #2D1B69); border-color: transparent; }
  .lp-stat-num { font-size: 26px; font-weight: 900; line-height: 1; letter-spacing: -0.025em; }
  .lp-stat-label { font-size: 11px; color: #9CA3AF; margin-top: 4px; }
  .lp-stat-box.dark .lp-stat-label { color: rgba(196,181,253,0.55); }
  .lp-meeting-box { background: white; border: 1px solid #EDE9FE; border-radius: 12px; padding: 14px; border-left: 3px solid #7C3AED; }
  .lp-meeting-head { font-size: 10px; color: #6D28D9; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; display: flex; align-items: center; gap: 5px; }
  .lp-meeting-name { font-size: 13px; font-weight: 600; color: #111827; }
  .lp-meeting-meta { font-size: 11px; color: #9CA3AF; margin-top: 2px; }

  /* ── RESULTS ── */
  .lp-results-wrap { background: #F5F3FF; border-top: 1px solid #EDE9FE; border-bottom: 1px solid #EDE9FE; }
  .lp-results-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 48px; }
  .lp-result-card { background: white; border: 1.5px solid #EDE9FE; border-radius: 20px; padding: 32px; transition: all 0.25s; box-shadow: 0 1px 4px rgba(109,40,217,0.04); position: relative; overflow: hidden; }
  .lp-result-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #2D1B69, #7C3AED, #A78BFA); }
  .lp-result-card:hover { border-color: #C4B5FD; box-shadow: 0 12px 40px rgba(109,40,217,0.1); transform: translateY(-4px); }
  .lp-result-num { font-size: 52px; font-weight: 900; line-height: 1; margin-bottom: 8px; letter-spacing: -0.025em; background: linear-gradient(135deg, #2D1B69, #7C3AED); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .lp-result-label { font-size: 15px; font-weight: 700; color: #111827; margin-bottom: 10px; }
  .lp-result-story { font-size: 13px; color: #6B7280; line-height: 1.75; }
  .lp-result-tag { display: inline-flex; margin-top: 16px; padding: 4px 12px; border-radius: 100px; font-size: 11px; font-weight: 600; background: #EDE9FE; color: #6D28D9; border: 1px solid #DDD6FE; }

  /* ── TESTIMONIALS ── */
  .lp-test-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 48px; }
  .lp-test-card { background: white; border: 1px solid #EDE9FE; border-radius: 20px; padding: 28px; transition: all 0.25s; box-shadow: 0 1px 4px rgba(109,40,217,0.04); }
  .lp-test-card:hover { border-color: #C4B5FD; box-shadow: 0 8px 32px rgba(109,40,217,0.09); transform: translateY(-3px); }
  .lp-test-stars { color: #8B5CF6; font-size: 13px; margin-bottom: 14px; letter-spacing: 2px; }
  .lp-test-quote { font-size: 14px; color: #374151; line-height: 1.8; margin-bottom: 20px; font-style: italic; }
  .lp-test-author { display: flex; align-items: center; gap: 10px; }
  .lp-test-av { width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0; background: linear-gradient(135deg, #2D1B69, #7C3AED); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; color: white; box-shadow: 0 2px 8px rgba(109,40,217,0.25); }
  .lp-test-name { font-size: 13px; font-weight: 700; color: #111827; }
  .lp-test-role { font-size: 12px; color: #9CA3AF; }

  /* ── PRICING ── */
  .lp-pricing-bg { background: white; border-top: 1px solid #E9E7F3; border-bottom: 1px solid #E9E7F3; }
  .lp-price-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 48px; }
  .lp-price-card { background: white; border: 1.5px solid #EDE9FE; border-radius: 20px; overflow: hidden; position: relative; transition: all 0.25s; box-shadow: 0 1px 4px rgba(109,40,217,0.04); }
  .lp-price-card-inner { padding: 32px; }
  .lp-price-card:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(109,40,217,0.1); }
  .lp-price-card.popular { border-color: #7C3AED; box-shadow: 0 8px 40px rgba(109,40,217,0.16); }
  .lp-price-popular-header { background: linear-gradient(135deg, #2D1B69, #7C3AED); padding: 10px 24px; text-align: center; }
  .lp-popular-badge { font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: rgba(255,255,255,0.9); }
  .lp-price-tier { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #9CA3AF; text-transform: uppercase; margin-bottom: 10px; }
  .lp-price-amt { font-size: 40px; font-weight: 900; color: #111827; line-height: 1; margin-bottom: 4px; letter-spacing: -0.025em; }
  .lp-price-period { font-size: 16px; font-weight: 500; color: #9CA3AF; }
  .lp-price-note { font-size: 12px; color: #6D28D9; font-weight: 600; margin: 6px 0 20px; }
  .lp-price-divider { height: 1px; background: #EDE9FE; margin-bottom: 20px; }
  .lp-price-feats { display: flex; flex-direction: column; gap: 9px; margin-bottom: 24px; }
  .lp-pf { display: flex; gap: 8px; font-size: 13px; color: #9CA3AF; align-items: flex-start; }
  .lp-pf.on { color: #111827; }
  .lp-pf-y { color: #7C3AED; font-weight: 700; flex-shrink: 0; }
  .lp-pf-n { color: #DDD6FE; font-weight: 700; flex-shrink: 0; }
  .lp-price-btn { width: 100%; padding: 13px; border-radius: 12px; font-size: 14px; font-weight: 700; text-decoration: none; border: none; cursor: pointer; display: block; text-align: center; transition: all 0.2s; }
  .lp-price-btn.dark { background: linear-gradient(135deg, #2D1B69, #7C3AED); color: white; box-shadow: 0 4px 14px rgba(109,40,217,0.3); }
  .lp-price-btn.dark:hover { box-shadow: 0 6px 20px rgba(109,40,217,0.45); transform: translateY(-1px); }
  .lp-price-btn.outline { background: transparent; color: #6D28D9; border: 1.5px solid #DDD6FE; }
  .lp-price-btn.outline:hover { background: #EDE9FE; border-color: #C4B5FD; }

  /* ── FAQ ── */
  .lp-faq-wrap { background: #F5F3FF; }
  .lp-faq-list { max-width: 720px; margin: 48px auto 0; }
  .lp-faq-item { border-bottom: 1px solid #EDE9FE; }
  .lp-faq-q { display: flex; justify-content: space-between; align-items: center; padding: 18px 0; cursor: pointer; width: 100%; text-align: left; font-size: 15px; font-weight: 600; color: #111827; background: none; border: none; gap: 16px; transition: color 0.2s; }
  .lp-faq-q:hover { color: #6D28D9; }
  .lp-faq-icon { font-size: 18px; color: #7C3AED; flex-shrink: 0; transition: transform 0.25s; font-weight: 300; }
  .lp-faq-icon.open { transform: rotate(45deg); }
  .lp-faq-a { font-size: 14px; color: #6B7280; line-height: 1.8; padding-bottom: 18px; }

  /* ── CTA ── */
  .lp-cta-wrap {
    background: linear-gradient(150deg, #050210 0%, #0D0425 25%, #1E0A3C 55%, #2D1B69 80%, #4C1D95 100%);
    padding: 112px 60px; text-align: center; position: relative; overflow: hidden;
  }
  .lp-cta-wrap::before { content: ''; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse 700px 500px at 25% 75%, rgba(167,139,250,0.13) 0%, transparent 65%), radial-gradient(ellipse 500px 400px at 75% 25%, rgba(124,58,237,0.16) 0%, transparent 65%); }
  .lp-cta-wrap::after { content: ''; position: absolute; inset: 0; pointer-events: none; background-image: radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px); background-size: 32px 32px; }
  .lp-cta-h2 { font-size: clamp(32px, 4vw, 52px); font-weight: 800; line-height: 1.15; letter-spacing: -0.025em; color: white; max-width: 760px; margin: 0 auto 18px; position: relative; z-index: 1; }
  .lp-cta-h2 span { color: #C4B5FD; text-shadow: 0 0 40px rgba(167,139,250,0.4); }
  .lp-cta-sub { font-size: 16px; color: rgba(255,255,255,0.5); max-width: 480px; margin: 0 auto 40px; line-height: 1.75; position: relative; z-index: 1; }
  .lp-cta-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; position: relative; z-index: 1; }
  .lp-btn-white-lg { background: white; color: #2D1B69; padding: 14px 28px; border-radius: 12px; font-size: 15px; font-weight: 700; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; transition: all 0.2s; box-shadow: 0 4px 16px rgba(0,0,0,0.2); }
  .lp-btn-white-lg:hover { box-shadow: 0 8px 28px rgba(0,0,0,0.28); transform: translateY(-2px); }
  .lp-btn-ghost-lg { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.8); padding: 14px 24px; border-radius: 12px; font-size: 15px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; border: 1.5px solid rgba(196,181,253,0.2); transition: all 0.2s; backdrop-filter: blur(8px); }
  .lp-btn-ghost-lg:hover { background: rgba(167,139,250,0.14); border-color: rgba(167,139,250,0.45); }
  .lp-cta-note { font-size: 12px; color: rgba(255,255,255,0.25); margin-top: 20px; position: relative; z-index: 1; }

  /* ── FOOTER ── */
  .lp-footer { background: #050210; padding: 48px 60px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 20px; border-top: 1px solid rgba(167,139,250,0.08); }
  .lp-footer-logo { display: flex; align-items: center; gap: 9px; text-decoration: none; }
  .lp-footer-logo-icon { width: 30px; height: 30px; border-radius: 8px; background: rgba(167,139,250,0.1); border: 1px solid rgba(167,139,250,0.18); display: flex; align-items: center; justify-content: center; font-size: 14px; color: white; }
  .lp-footer-logo-text { font-size: 16px; font-weight: 800; color: white; letter-spacing: -0.025em; }
  .lp-footer-links { display: flex; gap: 20px; flex-wrap: wrap; }
  .lp-footer-links a { font-size: 13px; color: rgba(255,255,255,0.22); text-decoration: none; transition: color 0.2s; }
  .lp-footer-links a:hover { color: rgba(167,139,250,0.8); }
  .lp-footer-copy { font-size: 12px; color: rgba(255,255,255,0.15); }

  /* ── REVEAL ── */
  .lp-reveal { opacity: 0; transform: translateY(20px); transition: opacity 0.55s ease, transform 0.55s ease; }
  .lp-reveal.visible { opacity: 1; transform: none; }

  /* ── RESPONSIVE ── */
  @media(max-width: 1024px) {
    .lp-nav { padding: 0 28px; }
    .lp-nav-links { display: none; }
    .lp-nav-right .lp-nav-signin { display: none; }
    .lp-menu-btn { display: block; }
    .lp-section { padding: 72px 28px; }
    .lp-pain-wrap { padding: 72px 28px; }
    .lp-bento { grid-template-columns: 1fr; }
    .lp-bento-big { grid-row: auto; min-height: 320px; }
    .lp-bento-full { flex-direction: column; }
    .lp-bento-full-visual { min-width: unset; width: 100%; }
    .lp-why-cards { grid-template-columns: 1fr; }
    .lp-how-wrap { padding: 72px 0; }
    .lp-how-header { padding: 0 28px; }
    .lp-how-cards { padding: 0 28px; }
    .lp-how-step { grid-template-columns: 1fr 200px; }
    .lp-feat-grid { grid-template-columns: 1fr; gap: 36px; }
    .lp-results-grid { grid-template-columns: 1fr; }
    .lp-test-grid { grid-template-columns: 1fr; }
    .lp-price-grid { grid-template-columns: 1fr; }
    .lp-hero-inner { padding: 64px 28px 80px; }
    .lp-belief-wrap { padding: 80px 28px; }
    .lp-cta-wrap { padding: 80px 28px; }
    .lp-footer { flex-direction: column; align-items: flex-start; padding: 40px 28px; }
  }
  @media(max-width: 640px) {
    .lp-nav { padding: 0 16px; }
    .lp-section { padding: 56px 16px; }
    .lp-pain-wrap { padding: 56px 16px; }
    .lp-hero-inner { padding: 48px 16px 64px; }
    .lp-hero-metrics { grid-template-columns: repeat(3,1fr); gap: 8px; }
    .lp-form-socials { flex-direction: column; }
    .lp-how-wrap { padding: 56px 0; }
    .lp-how-header { padding: 0 16px; }
    .lp-how-cards { padding: 0 16px; }
    .lp-how-step { grid-template-columns: 1fr; }
    .lp-how-step-right { display: none; }
    .lp-bento-full { padding: 28px 20px; }
    .lp-belief-wrap { padding: 72px 16px; }
    .lp-cta-wrap { padding: 72px 16px; }
    .lp-footer { padding: 32px 16px; }
  }
`;

function useReveal() {
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("visible"); }),
      { threshold: 0.04 }
    );
    document.querySelectorAll(".lp-reveal").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

export default function Home() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  useReveal();

  useEffect(() => {
    const el = document.createElement("style");
    el.innerHTML = CSS;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const tickers = [
    ["WhatsApp Lead Gen", "↑ 340%"], ["Meeting Book Rate", "40%"],
    ["Cost per Lead", "₹18"], ["Replaces ₹50K Agency", "₹1,799/mo"],
    ["Languages Supported", "4"], ["Lead → Meeting", "< 48 hrs"],
    ["WhatsApp Open Rate", "78%"], ["Runs 24/7", "Zero Effort"],
  ];

  const faqs = [
    { q: "Does it really feel human on WhatsApp? Won't people know it's a bot?", a: "MYSA is trained to have natural, flowing conversations — not robotic scripts. It uses the lead's own words, adapts tone, and responds in their language. Most leads only find out it's AI when they eventually meet you and ask. Our hook rate is 34% — vs 8% for cold email." },
    { q: "How is this different from just buying a list and blasting WhatsApp?", a: "Completely different. Blasting gets you banned. MYSA uses official WhatsApp Business API, verifies each number first, and sends personalised messages based on each lead's actual business situation. The Belief Audit is written by AI for that specific company." },
    { q: "What industries does this work for?", a: "B2B service businesses — web/software agencies, real estate, consulting, education, healthcare, manufacturing, D2C brands. If your average deal is above ₹15,000, MYSA pays for itself with a single new client." },
    { q: "How long does it take to set up?", a: "48 hours. We handle the WhatsApp API connection, configure your AI persona, load your portfolio, set ICP filters, and connect your Calendly. You give us inputs. We do the rest. By day 3, your agent is running." },
    { q: "What is the Belief Alignment Score?", a: "BANT tells you if someone can buy. The Belief Score tells you if they should buy — for the long term. Our AI scans their LinkedIn, website About page, and founder story. Belief-aligned leads have 3× higher LTV." },
    { q: "I'm already paying an agency ₹40,000/month. Why switch?", a: "Because your agency is doing for ₹40,000 what MYSA does for ₹1,799. MYSA runs 24/7, replies in 60 seconds, books meetings automatically, and improves over time. Your agency sleeps. MYSA doesn't." },
  ];

  const steps = [
    { n:"01", icon:"📱", h:"Verify on WhatsApp", p:"MYSA checks every lead — is this number active on WhatsApp? If yes, proceed. If no, skip and log. Zero wasted outreach." },
    { n:"02", icon:"🎣", h:"Send the Hook", p:'"We did a Business Audit on your company and found something important." Curiosity, not pitch. Belief-first messaging.' },
    { n:"03", icon:"📋", h:"Deliver the Audit", p:"They reply YES. AI generates a personalised Business Belief Audit — what they've built vs what the world currently sees." },
    { n:"04", icon:"🧠", h:"AI Qualifies Them", p:"Conversational BANT + Belief Alignment scoring. Budget. Authority. Need. Timeline. AND belief alignment. High score = best future client." },
    { n:"05", icon:"📁", h:"Send Your Portfolio", p:'AI sends your case studies, portfolio, reference websites — as stories. "This founder believed X — here\'s what happened."' },
    { n:"06", icon:"📅", h:"Book the Meeting", p:"AI sends your Calendly link and books a slot. You wake up with qualified meetings — with people who already trust you." },
    { n:"07", icon:"💾", h:"Everything Stored", p:"Full conversation, lead data, BANT + Belief scores, meeting notes — all synced to your MYSA CRM. Always clean." },
    { n:"★", icon:"🏆", h:"You close. MYSA finds.", p:"You do what you're good at — delivering great work. MYSA fills your calendar with the right people.", result: true },
  ];

  return (
    <div className="lp">

      {/* ── NAV ── */}
      <nav className={`lp-nav${scrolled ? " scrolled" : ""}`}>
        <a href="#" className="lp-logo">
          <div className="lp-logo-icon">⚡</div>
          <span className="lp-logo-text">MysaAI</span>
        </a>
        <ul className="lp-nav-links">
          <li><a href="#why">Why MYSA</a></li>
          <li><a href="#how">How It Works</a></li>
          <li><a href="#results">Results</a></li>
          <li><a href="#pricing">Pricing</a></li>
        </ul>
        <div className="lp-nav-right">
          <a href={`${APP_URL}/login`} className="lp-nav-signin">Sign In</a>
          <a href={`${APP_URL}/register`} className="lp-nav-cta">Start Free Trial →</a>
          <button className="lp-menu-btn" onClick={() => setMobileOpen(true)}>☰</button>
        </div>
      </nav>

      {/* ── MOBILE NAV ── */}
      <div className={`lp-mobile-nav${mobileOpen ? " open" : ""}`}>
        <div className="lp-mobile-header">
          <a href="#" className="lp-logo">
            <div className="lp-logo-icon">⚡</div>
            <span className="lp-logo-text">MysaAI</span>
          </a>
          <button style={{ background: "none", border: "none", fontSize: 26, cursor: "pointer" }} onClick={() => setMobileOpen(false)}>✕</button>
        </div>
        <div className="lp-mobile-links">
          {[["#why","Why MYSA"],["#how","How It Works"],["#results","Results"],["#pricing","Pricing"]].map(([h,l]) => (
            <a key={h} href={h} onClick={() => setMobileOpen(false)}>{l}</a>
          ))}
        </div>
        <div className="lp-mobile-actions">
          <a href={`${APP_URL}/login`} style={{ padding: "12px", borderRadius: 12, border: "1.5px solid #EDE9FE", textAlign: "center", fontWeight: 600, fontSize: 14, textDecoration: "none", color: "#111827", display: "block" }}>Sign In</a>
          <a href={`${APP_URL}/register`} style={{ padding: "13px", borderRadius: 12, background: "linear-gradient(135deg, #2D1B69, #7C3AED)", textAlign: "center", fontWeight: 700, fontSize: 14, textDecoration: "none", color: "white", display: "block" }}>Start Free Trial →</a>
        </div>
      </div>

      {/* ── HERO ── */}
      <div className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-hero-badge">
            <div className="lp-badge-dot" />
            AI Sales Automation · India's #1 WhatsApp Growth Platform
          </div>
          <h1>
            The AI Sales Brain for<br />
            <span>B2B Growth Companies</span>
          </h1>
          <p className="lp-hero-sub">
            The only sales OS that audits your prospects, scores their belief, writes personalised outreach, and closes deals. <strong>While you sleep.</strong>
          </p>

          {/* ── SIGNUP FORM ── */}
          <div className="lp-hero-form">
            <div className="lp-form-row">
              <input
                className="lp-form-input"
                type="email"
                placeholder="Enter your work email"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
              <button
                className="lp-form-btn"
                onClick={() => { window.location.href = `${APP_URL}/register${email ? `?email=${encodeURIComponent(email)}` : ""}`; }}
              >
                Get Started Free →
              </button>
            </div>
            <div className="lp-form-or"><span>or</span></div>
            <div className="lp-form-socials">
              <a href={`${APP_URL}/login?provider=google`} className="lp-form-social">
                <span dangerouslySetInnerHTML={{ __html: GOOGLE_SVG }} />
                Sign up with Google
              </a>
              <a href={`${APP_URL}/login?provider=microsoft`} className="lp-form-social">
                <span dangerouslySetInnerHTML={{ __html: MS_SVG }} />
                Sign up with Microsoft
              </a>
            </div>
            <p className="lp-form-note">
              By signing up, you agree to MYSA's <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
            </p>
          </div>

          <div className="lp-hero-metrics">
            {[{n:"3×",l:"Pipeline growth"},{n:"68%",l:"Faster outreach"},{n:"41%",l:"More deals won"}].map(({n,l}) => (
              <div key={l} className="lp-metric-card">
                <div className="lp-metric-num">{n}</div>
                <div className="lp-metric-label">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── TICKER ── */}
      <div className="lp-ticker">
        <div className="lp-ticker-inner">
          {[...tickers,...tickers].map(([l,v],i) => (
            <div key={i} className="lp-ticker-item">
              <div className="lp-ticker-dot"/>{l} <span>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── PAIN — DARK BENTO ── */}
      <div className="lp-pain-wrap">
        <div className="lp-pain-header lp-reveal">
          <div className="lp-pain-eyebrow">The Real Problem</div>
          <h2 className="lp-pain-h2">You're good at what you do.<br /><span>Nobody knows yet.</span></h2>
          <p className="lp-pain-sub">Most Indian businesses don't fail because their product is bad. They fail because the right people never found them.</p>
        </div>

        <div className="lp-bento lp-reveal">
          {/* Big left card */}
          <div className="lp-bento-big">
            <div>
              <div className="lp-bento-tag">The Gap</div>
              <div className="lp-bento-title">That gap — between what you've built and who knows about it — is exactly what MYSA was built to close.</div>
              <p className="lp-bento-desc" style={{marginTop:12}}>You're spending ₹30,000–₹1,00,000 every month on agencies that send you PowerPoints instead of pipeline. <strong style={{color:"rgba(255,255,255,0.7)"}}>It doesn't have to be this way.</strong></p>
            </div>
            <div className="lp-bento-visual">
              <div className="lp-bento-invoice">
                <div style={{fontSize:10,color:"rgba(255,255,255,0.25)",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Agency Invoice — March 2025</div>
                {[["Strategy Deck","₹8,000"],["Social Media Posts","₹12,000"],["Ad Campaign Mgmt","₹15,000"],["Monthly Report","₹5,000"]].map(([s,v]) => (
                  <div key={s} className="lp-bento-invoice-row"><span>{s}</span><span>{v}</span></div>
                ))}
                <div className="lp-bento-invoice-total"><span>Total Paid</span><span>₹40,000</span></div>
                <div style={{fontSize:11,color:"rgba(239,68,68,0.6)",marginTop:8}}>Leads generated this month: 3 (unqualified)</div>
              </div>
            </div>
          </div>

          {/* Right column */}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div className="lp-bento-small lp-reveal">
              <div className="lp-bento-tag">4 hrs/day</div>
              <div className="lp-bento-title">"I spend 4 hours a day doing follow-ups that go nowhere."</div>
              <p className="lp-bento-desc" style={{marginTop:8}}>You built a business to build things — not to chase people on WhatsApp who said "send me details" and disappeared.</p>
              <div className="lp-bento-clock">4h<span>wasted daily on cold follow-ups</span></div>
            </div>

            <div className="lp-bento-small lp-reveal">
              <div className="lp-bento-tag">The Paradox</div>
              <div className="lp-bento-title">"My competitors have worse work but better marketing."</div>
              <p className="lp-bento-desc" style={{marginTop:8}}>Because they have a system. Not better talent. A system that finds prospects, nurtures them, and closes while they sleep.</p>
              <div className="lp-bento-chart">
                {[30,55,45,70,52,85,60,95].map((h,i) => (
                  <div key={i} className="lp-bento-bar" style={{height:`${h}%`}}>
                    <div style={{position:"absolute",bottom:0,left:0,right:0,background:`linear-gradient(to top, rgba(167,139,250,${0.3+i*0.04}), rgba(167,139,250,0.08))`,height:"100%",borderRadius:"4px 4px 0 0"}}/>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom full-width card */}
          <div className="lp-bento-full lp-reveal">
            <div className="lp-bento-full-text">
              <div className="lp-bento-tag">The Opportunity</div>
              <div className="lp-bento-title">MYSA finds, qualifies, and books the meetings — while you sleep.</div>
              <p className="lp-bento-desc">From a cold scraped number to a booked, belief-aligned meeting in your calendar — fully automated, 24/7, in 4 languages. For ₹1,799/month.</p>
              <a href={`${APP_URL}/register`} className="lp-bento-cta">Start Free Trial →</a>
            </div>
            <div className="lp-bento-full-visual">
              <div style={{fontSize:10,color:"rgba(167,139,250,0.5)",letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>MYSA Live Dashboard</div>
              {[{dot:"#A78BFA",l:"Leads scraped",v:"1,500",vc:"rgba(167,139,250,0.9)"},
                {dot:"#7C3AED",l:"SQLs qualified",v:"312",vc:"rgba(124,58,237,0.9)"},
                {dot:"#34D399",l:"Meetings booked",v:"23 🔥",vc:"#34D399"},
                {dot:"#EF4444",l:"Agency cost",v:"₹0",vc:"#EF4444"},
              ].map(({dot,l,v,vc}) => (
                <div key={l} className="lp-bento-stat-row">
                  <div className="lp-bento-stat-dot" style={{background:dot}}/>
                  <span className="lp-bento-stat-label">{l}</span>
                  <span className="lp-bento-stat-val" style={{color:vc}}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── BELIEF ── */}
      <div className="lp-belief-wrap lp-reveal">
        <div className="lp-belief-eyebrow">Our Belief</div>
        <div className="lp-belief-line"/>
        <p className="lp-belief-quote">
          "Every business that was built with genuine purpose<br />
          deserves to be <span>seen, found, and chosen</span> —<br />
          not just by algorithm, but by the right people."
        </p>
        <div className="lp-belief-line"/>
        <p className="lp-belief-attr">— Krishna Puranik, Founder · Dreamsdesign & MYSA AI</p>
        <p className="lp-belief-sub">
          MYSA was built for founders who know their purpose but haven't found their pipeline yet. We don't sell you marketing. We give you a system that finds the people who already need what you're building.
        </p>
      </div>

      {/* ── WHY ── */}
      <div className="lp-why-wrap">
        <section id="why">
          <div className="lp-section">
            <div className="lp-reveal" style={{textAlign:"center"}}>
              <span className="lp-eyebrow">The Golden Circle</span>
              <h2 className="lp-h2">We start with <em>WHY.</em><br />So should your sales.</h2>
              <p className="lp-lead" style={{margin:"0 auto",maxWidth:560}}>
                Most sales systems sell features. MYSA starts with belief. Because people don't buy what you do — they buy <strong>why you do it.</strong>
              </p>
            </div>
            <div className="lp-why-cards">
              {[
                {badge:"WHY — The Belief",h3:'"Every purpose-driven business deserves to be found."',p:"This is why MYSA exists. Not to spam inboxes — but to connect what you've genuinely built with the people who genuinely need it. The right match creates the best clients."},
                {badge:"HOW — The Approach",h3:'"We find belief alignment before we find budget."',p:"Our AI doesn't just BANT-score leads. It runs a Belief Alignment Score — finding prospects whose mission aligns with yours. These become your longest-retaining, highest-referral clients."},
                {badge:"WHAT — The System",h3:'"An AI that sells the way your best salesperson would — if they never slept."',p:"WhatsApp AI agent. Multilingual. BANT + Belief qualified. Sends your portfolio, case studies, books meetings. All while you focus on doing the actual work."},
              ].map(({badge,h3,p}) => (
                <div key={badge} className="lp-why-card lp-reveal">
                  <div className="lp-why-card-header">
                    <div className="lp-why-badge">{badge}</div>
                  </div>
                  <div className="lp-why-card-body">
                    <h3>{h3}</h3><p>{p}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ── HOW IT WORKS — LARGE STACKED CARDS ── */}
      <div className="lp-how-wrap" id="how">
        <div className="lp-how-header lp-reveal">
          <div className="lp-how-eyebrow">How It Works</div>
          <h2 className="lp-how-h2">Your AI sales team.<br /><em>7 steps. Zero effort.</em></h2>
          <p className="lp-how-sub">From a cold scraped number to a booked meeting — MYSA handles every step autonomously, in 4 languages, 24/7.</p>
        </div>
        <div className="lp-how-cards">
          {steps.map(({n,icon,h,p,result}) => (
            <div key={n} className={`lp-how-step lp-reveal${result ? " result" : ""}`}>
              <div className="lp-how-step-left">
                <div className="lp-step-badge">STEP {n}</div>
                <div className="lp-how-step-h3">{h}</div>
                <p className="lp-how-step-p">{p}</p>
              </div>
              <div className="lp-how-step-right">
                <div className="lp-how-step-num-bg">{n}</div>
                <div className="lp-how-step-icon">{icon}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── FEATURES ── */}
      <div className="lp-section">
        <div className="lp-reveal" style={{textAlign:"center",marginBottom:56}}>
          <span className="lp-eyebrow">Platform Features</span>
          <h2 className="lp-h2">Built for founders.<br /><em>Not for agencies.</em></h2>
        </div>

        <div className="lp-feat-grid lp-reveal">
          <div className="lp-feat-panel">
            <div className="lp-panel-tag">MYSA WhatsApp Agent · Live</div>
            <div className="lp-feat-panel-inner">
              <div className="lp-chat-row">
                <div className="lp-chat-av">🤖</div>
                <div>
                  <div className="lp-chat-tag">MYSA AI</div>
                  <div className="lp-chat-body">Namaste Rajesh! 🙏 We ran a Business Audit on <strong>Sharma Textiles</strong> — your work is genuinely good, but the internet doesn't know that yet. Reply <strong>YES</strong> to see your free report.</div>
                </div>
              </div>
              <div className="lp-chat-row">
                <div className="lp-chat-av">👤</div>
                <div>
                  <div className="lp-chat-tag user">Lead</div>
                  <div className="lp-chat-body">Yes please</div>
                </div>
              </div>
              <div className="lp-chat-row">
                <div className="lp-chat-av">🤖</div>
                <div>
                  <div className="lp-chat-tag">MYSA AI · Gujarati</div>
                  <div className="lp-chat-body">🎉 ધન્યવાદ Rajesh! Your Business Belief Audit is ready. We found 3 gaps between what you've built and what the market currently sees...</div>
                </div>
              </div>
              <div className="lp-score-row">
                <div style={{flex:1}}>
                  <div className="lp-score-label">BANT + Belief Score</div>
                  <div className="lp-score-bar"><div className="lp-score-fill" style={{width:"87%"}}/></div>
                </div>
                <div className="lp-score-num">87</div>
              </div>
            </div>
          </div>
          <div>
            <span className="lp-eyebrow">WhatsApp Sales Brain</span>
            <h2 className="lp-h2" style={{fontSize:"clamp(24px,2.8vw,34px)"}}>Conversations that feel human.<br /><em>Scale that feels AI.</em></h2>
            <p className="lp-lead" style={{fontSize:15}}>MYSA's agent speaks English, Hindi, Gujarati, and Marathi — auto-detecting your lead's language. Every message feels personal because it is.</p>
            <div className="lp-feat-list">
              {[["Auto-detects language from name & location","Switches between EN, HI, GU, MR mid-conversation"],
                ["Business Belief Audit per prospect","Industry-specific, emotionally resonant, not generic"],
                ["Handles objections, questions, follow-ups","Never lets a warm lead go cold"],
                ["Books meetings into your calendar","Calendly integration — zero manual coordination"],
              ].map(([m,s]) => (
                <div key={m} className="lp-fi">
                  <div className="lp-fi-dot">✓</div>
                  <div><div className="lp-fi-main">{m}</div><div className="lp-fi-sub">{s}</div></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lp-feat-grid lp-reveal" style={{marginTop:56,direction:"rtl"}}>
          <div className="lp-feat-panel" style={{direction:"ltr"}}>
            <div className="lp-panel-tag">MYSA Lead Intelligence</div>
            <div className="lp-feat-panel-inner">
              <div className="lp-stats-grid">
                {[{n:"1,500",c:"#6D28D9",l:"Leads Scraped Today",dark:false},
                  {n:"312",c:"#7C3AED",l:"SQLs Qualified",dark:false},
                  {n:"94",c:"#DC2626",l:"Replies Received",dark:false},
                  {n:"23",c:"#A78BFA",l:"Meetings Booked 🔥",dark:true},
                ].map(({n,c,l,dark}) => (
                  <div key={l} className={`lp-stat-box${dark?" dark":""}`}>
                    <div className="lp-stat-num" style={{color:dark?"#A78BFA":c}}>{n}</div>
                    <div className="lp-stat-label">{l}</div>
                  </div>
                ))}
              </div>
              <div className="lp-meeting-box">
                <div className="lp-meeting-head"><span>🔔</span> New Meeting — Just Now</div>
                <div className="lp-meeting-name">Rajesh Sharma · Sharma Textiles · Tomorrow 11:00 AM</div>
                <div className="lp-meeting-meta">BANT: 4/4 · Belief Score: 9/10 · Gujarati</div>
              </div>
            </div>
          </div>
          <div style={{direction:"ltr"}}>
            <span className="lp-eyebrow">Lead Intelligence Engine</span>
            <h2 className="lp-h2" style={{fontSize:"clamp(24px,2.8vw,34px)"}}>Find the leads worth your time.<br /><em>Skip the rest.</em></h2>
            <p className="lp-lead" style={{fontSize:15}}>MYSA scrapes 1,500+ leads daily from Apollo, LinkedIn, JustDial, IndiaMart. Then runs every single one through AI qualification before a single message is sent.</p>
            <div className="lp-feat-list">
              {[["Apollo + LinkedIn + JustDial + IndiaMart","Multi-source scraping — freshest leads daily"],
                ["BANT + Belief Alignment Score (5 dimensions)","Budget · Authority · Need · Timeline · Belief"],
                ["Email verification before every outreach","97%+ deliverability — no wasted sends"],
                ["US + UK + India market targeting","International B2B and domestic Indian SME pipelines"],
              ].map(([m,s]) => (
                <div key={m} className="lp-fi">
                  <div className="lp-fi-dot">✓</div>
                  <div><div className="lp-fi-main">{m}</div><div className="lp-fi-sub">{s}</div></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── RESULTS ── */}
      <div className="lp-results-wrap" id="results">
        <div className="lp-section lp-reveal">
          <div style={{textAlign:"center"}}>
            <span className="lp-eyebrow">Real Results</span>
            <h2 className="lp-h2">Not metrics. <em>Missions accomplished.</em></h2>
            <p className="lp-lead" style={{margin:"0 auto"}}>Every number below represents a founder who believed in something — and finally found the people who believed in it too.</p>
          </div>
          <div className="lp-results-grid">
            {[{m:"340",l:"Qualified leads in 60 days",s:"A Lucknow real estate founder believed buyers deserved honest guidance. MYSA aligned his outreach to his actual belief — and brought him the right 340 people, not just any 340.",t:"Real Estate · Lucknow"},
              {m:"9×",l:"Revenue growth in 4 months",s:"₹2L to ₹18L/month — not because she got more traffic, but because the right customers finally found her through MYSA's belief-aligned outreach system.",t:"D2C Brand · Ahmedabad"},
              {m:"₹0",l:"Spent on agencies. Ever again.",s:"A Mumbai SaaS founder was paying ₹80,000/month to an agency for 'strategy.' Switched to MYSA at ₹1,799/month. In 90 days he had more qualified leads than the agency delivered in a year.",t:"SaaS · Mumbai"},
            ].map(({m,l,s,t}) => (
              <div key={m} className="lp-result-card lp-reveal">
                <div className="lp-result-num">{m}</div>
                <div className="lp-result-label">{l}</div>
                <div className="lp-result-story">{s}</div>
                <span className="lp-result-tag">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── TESTIMONIALS ── */}
      <div className="lp-section lp-reveal">
        <div style={{textAlign:"center"}}>
          <span className="lp-eyebrow">What Founders Say</span>
          <h2 className="lp-h2">They didn't buy a tool.<br /><em>They found a system.</em></h2>
        </div>
        <div className="lp-test-grid">
          {[{i:"R",q:'"I was spending ₹60,000 a month on an agency and getting 5-6 random leads. MYSA gave me 23 booked meetings in the first month. These were people who actually understood what I do. The Belief Audit really works."',n:"Rajesh Mehta",r:"Founder, TechNova Solutions · Surat"},
            {i:"P",q:'"MYSA doesn\'t just find leads — it finds the right leads. The WhatsApp bot speaks Gujarati and feels completely natural. My customers don\'t even realise it\'s AI until I tell them. That\'s the level."',n:"Priya Shah",r:"Founder, Priya D2C · Ahmedabad"},
            {i:"A",q:'"Krishna and the MYSA team actually understand what growth means for Indian businesses. This isn\'t some US tool translated for India. It was built here, for us. The WhatsApp-first approach alone is worth the entire subscription."',n:"Amit Patel",r:"CEO, Patel Manufacturing · Rajkot"},
          ].map(({i,q,n,r}) => (
            <div key={n} className="lp-test-card lp-reveal">
              <div className="lp-test-stars">★★★★★</div>
              <p className="lp-test-quote">{q}</p>
              <div className="lp-test-author">
                <div className="lp-test-av">{i}</div>
                <div><div className="lp-test-name">{n}</div><div className="lp-test-role">{r}</div></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── PRICING ── */}
      <div className="lp-pricing-bg">
        <section id="pricing" className="lp-section lp-reveal">
          <div style={{textAlign:"center"}}>
            <span className="lp-eyebrow">Simple Pricing</span>
            <h2 className="lp-h2">Less than what you pay<br /><em>for bad leads.</em></h2>
            <p className="lp-lead" style={{margin:"0 auto"}}>No lock-in. No hidden fees. Cancel anytime. Start with a free trial — no credit card required.</p>
          </div>
          <div className="lp-price-grid">
            <div className="lp-price-card">
              <div className="lp-price-card-inner">
                <div className="lp-price-tier">Starter</div>
                <div className="lp-price-amt">₹5,999<span className="lp-price-period">/mo</span></div>
                <div className="lp-price-note">Less than one lost lead</div>
                <div className="lp-price-divider"/>
                <div className="lp-price-feats">
                  {[["300 leads/month",1],["WhatsApp AI Agent",1],["Business Belief Audit",1],["2 languages (EN + HI)",1],["BANT Qualification",1],["Meeting Booking Bot",0],["Portfolio Auto-Send",0],["Belief Score",0]].map(([f,on]) => (
                    <div key={String(f)} className={`lp-pf${on?" on":""}`}>
                      <span className={on?"lp-pf-y":"lp-pf-n"}>{on?"✓":"✕"}</span>{f}
                    </div>
                  ))}
                </div>
                <a href={`${APP_URL}/register`} className="lp-price-btn outline">Start Free Trial</a>
              </div>
            </div>
            <div className="lp-price-card popular">
              <div className="lp-price-popular-header">
                <div className="lp-popular-badge">MOST POPULAR</div>
              </div>
              <div className="lp-price-card-inner">
                <div className="lp-price-tier">Growth</div>
                <div className="lp-price-amt">₹17,999<span className="lp-price-period">/mo</span></div>
                <div className="lp-price-note">Cheaper than 1 day of a salesperson</div>
                <div className="lp-price-divider"/>
                <div className="lp-price-feats">
                  {["1,500 leads/month","Full WhatsApp Sales Brain","All 4 languages","BANT + Belief Score","Meeting Auto-Booking","Portfolio + Case Study Send","MYSA CRM Dashboard","Slack + Calendar Alerts"].map(f => (
                    <div key={f} className="lp-pf on"><span className="lp-pf-y">✓</span>{f}</div>
                  ))}
                </div>
                <a href={`${APP_URL}/register`} className="lp-price-btn dark">Start Free Trial →</a>
              </div>
            </div>
            <div className="lp-price-card">
              <div className="lp-price-card-inner">
                <div className="lp-price-tier">Emperor</div>
                <div className="lp-price-amt">₹56,999<span className="lp-price-period">/mo</span></div>
                <div className="lp-price-note">Replace a full sales team</div>
                <div className="lp-price-divider"/>
                <div className="lp-price-feats">
                  {["Unlimited leads","Everything in Growth","Custom AI persona & voice","25 LinkedIn accounts","Meta + Google Ads AI","GST & Compliance Module","Dedicated Growth Manager","Monthly call with Krishna"].map(f => (
                    <div key={f} className="lp-pf on"><span className="lp-pf-y">✓</span>{f}</div>
                  ))}
                </div>
                <a href="#demo" className="lp-price-btn dark">Talk to Krishna →</a>
              </div>
            </div>
          </div>
          <p style={{textAlign:"center",fontSize:13,color:"#9CA3AF",marginTop:20}}>
            🔒 No credit card required · Cancel anytime · Setup in 48 hours · Support in Hindi &amp; English
          </p>
        </section>
      </div>

      {/* ── FAQ ── */}
      <div className="lp-faq-wrap">
        <div className="lp-section lp-reveal">
          <div style={{textAlign:"center"}}>
            <span className="lp-eyebrow">Common Questions</span>
            <h2 className="lp-h2">Honest answers.<br /><em>No sales spin.</em></h2>
          </div>
          <div className="lp-faq-list">
            {faqs.map(({q,a},i) => (
              <div key={i} className="lp-faq-item">
                <button className="lp-faq-q" onClick={() => setOpenFaq(openFaq===i?null:i)}>
                  {q}<span className={`lp-faq-icon${openFaq===i?" open":""}`}>+</span>
                </button>
                {openFaq===i && <p className="lp-faq-a">{a}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── CTA ── */}
      <div id="demo" className="lp-cta-wrap lp-reveal">
        <h2 className="lp-cta-h2">
          Your next client is out there.<br />
          <span>Let MYSA find them tonight.</span>
        </h2>
        <p className="lp-cta-sub">Start your free trial. No credit card. Setup in 48 hours. Your first qualified lead within a week — or we set up for free.</p>
        <div className="lp-cta-actions">
          <a href={`${APP_URL}/register`} className="lp-btn-white-lg">Get Your Free Growth Audit →</a>
          <a href={`${APP_URL}/login`} className="lp-btn-ghost-lg">Sign In to Dashboard</a>
        </div>
        <p className="lp-cta-note">🔒 No credit card · 48-hour setup · Support in Hindi &amp; English</p>
      </div>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <a href="#" className="lp-footer-logo">
          <div className="lp-footer-logo-icon">⚡</div>
          <span className="lp-footer-logo-text">MysaAI</span>
        </a>
        <div className="lp-footer-links">
          {[["#why","Why MYSA"],["#how","How It Works"],["#pricing","Pricing"],
            [`${APP_URL}/login`,"Sign In"],[`${APP_URL}/register`,"Sign Up"],["#demo","Contact"],
          ].map(([h,l]) => <a key={l} href={h}>{l}</a>)}
        </div>
        <p className="lp-footer-copy">© 2026 Dreamsdesign · MysaAI · Built for founders who mean it.</p>
      </footer>
    </div>
  );
}
