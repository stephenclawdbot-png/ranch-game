/** Scoped CSS for the viewer HUD (injected once; every class is prefixed `rv-`). */
export const VIEWER_CSS = `
.rv-root{--rv-ink:#0b0f0c;--rv-green:#0f2a1d;--rv-green2:#163a28;--rv-cream:#f3e7c9;--rv-brass:#d9a441;--rv-brass2:#f2c86a;--rv-ox:#7a1f1f;--rv-live:#e5483a;
  --rv-f-display:var(--font-display,"Pixelify Sans","Courier New",monospace);--rv-f-pixel:var(--font-pixel,"Silkscreen",monospace);--rv-f-num:var(--font-num,"Jersey 10",monospace);--rv-f-sans:var(--font-sans,ui-sans-serif,system-ui,sans-serif);
  position:relative;width:100%;font-family:var(--rv-f-sans);color:var(--rv-cream);-webkit-tap-highlight-color:transparent;outline:none}
.rv-panel,.rv-chip,.rv-st,.rv-ticker,.rv-btn,.rv-count,.rv-card,.rv-debug{border-radius:0}
.rv-stage{position:relative;width:100%;overflow:hidden;background:var(--rv-green);border:3px solid var(--rv-ink);box-shadow:inset 0 0 0 2px rgba(242,200,106,.35),0 6px 0 rgba(0,0,0,.35);touch-action:manipulation;user-select:none;-webkit-user-select:none}
.rv-canvas{position:absolute;inset:0}
.rv-canvas canvas{display:block;width:100%!important;height:100%!important}
.rv-loading{position:absolute;inset:0;display:grid;place-items:center;font:12px var(--rv-f-pixel);letter-spacing:.08em;text-transform:uppercase;color:rgba(243,231,201,.7)}
.rv-hud{position:absolute;left:0;right:0;top:0;padding:10px 12px 18px;display:flex;flex-direction:column;gap:6px;pointer-events:none;background:linear-gradient(rgba(8,21,14,.7),rgba(8,21,14,.3) 70%,rgba(8,21,14,0))}
.rv-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.rv-title{min-width:0}
.rv-name{font-family:var(--rv-f-display);font-weight:700;font-size:18px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--rv-cream);text-shadow:2px 2px 0 var(--rv-ink)}
.rv-chips{display:flex;gap:5px;margin-top:5px;flex-wrap:wrap}
.rv-chip{font:10px/1 var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.04em;padding:4px 6px 3px;background:var(--rv-green2);border:2px solid var(--rv-ink);box-shadow:inset 1px 1px 0 rgba(255,255,255,.12);white-space:nowrap}
.rv-chip-turf{background:#2c6645}
.rv-chip-dirt{background:#7a4a2a}
.rv-chip-synthetic{background:#4d4466}
.rv-clock{text-align:right;flex:none}
.rv-time{font-family:var(--rv-f-num);font-size:34px;line-height:.9;font-variant-numeric:tabular-nums;color:var(--rv-brass2);text-shadow:2px 2px 0 var(--rv-ink)}
.rv-togo{font:10px var(--rv-f-pixel);text-transform:uppercase;margin-top:3px;letter-spacing:.04em;text-shadow:1px 1px 0 var(--rv-ink)}
.rv-standings{display:flex;gap:4px;pointer-events:auto}
.rv-st-cand{display:flex;gap:4px;position:absolute;visibility:hidden;pointer-events:none}
.rv-st{display:flex;align-items:center;gap:5px;flex:none;font-size:12px;font-weight:700;line-height:1;padding:3px 7px 3px 3px;background:rgba(15,42,29,.9);border:2px solid var(--rv-ink);box-shadow:inset 1px 1px 0 rgba(242,200,106,.18);white-space:nowrap}
.rv-st-me{background:#3a2c0e;box-shadow:inset 0 0 0 2px var(--rv-brass)}
.rv-st-pos{font-family:var(--rv-f-num);font-size:17px;font-weight:400;width:16px;text-align:center;color:var(--rv-brass2)}
.rv-st-gap{opacity:.75;font-weight:600;font-variant-numeric:tabular-nums}
.rv-swatch{display:inline-block;vertical-align:middle;width:12px;height:12px;flex:none;border:2px solid var(--rv-ink);image-rendering:pixelated}
.rv-ticker{align-self:flex-start;max-width:min(560px,92%);font-size:13px;font-weight:700;padding:5px 10px 5px 8px;background:rgba(11,15,12,.85);border:2px solid var(--rv-ink);border-left:4px solid var(--rv-brass);animation:rv-in .3s steps(3)}
@keyframes rv-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.rv-controls{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:6px;padding:16px 10px 8px;background:linear-gradient(rgba(8,21,14,0),rgba(8,21,14,.82) 45%)}
.rv-btn{appearance:none;border:2px solid var(--rv-ink);background:var(--rv-green2);color:var(--rv-cream);font:11px var(--rv-f-pixel);text-transform:uppercase;min-width:36px;height:36px;padding:0 9px;display:inline-flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;flex:none;touch-action:manipulation;box-shadow:inset 2px 2px 0 rgba(255,255,255,.14),inset -2px -2px 0 rgba(0,0,0,.35)}
.rv-btn:hover{background:#1f4d35}
.rv-btn:active{box-shadow:inset 2px 2px 0 rgba(0,0,0,.35)}
.rv-btn:focus-visible{outline:2px solid var(--rv-brass2);outline-offset:1px}
.rv-btn[aria-pressed=true]{background:var(--rv-brass);color:var(--rv-ink);box-shadow:inset 2px 2px 0 rgba(255,241,193,.7),inset -2px -2px 0 rgba(122,84,24,.8)}
.rv-btn:disabled{opacity:.4;cursor:default}
.rv-seg{display:flex;flex:none;gap:0}
.rv-seg .rv-btn+.rv-btn{border-left-width:0}
.rv-scrub{flex:1;min-width:60px;display:flex;align-items:center;gap:8px}
.rv-range{flex:1;min-width:40px;height:28px;accent-color:var(--rv-brass);cursor:pointer;background:transparent}
.rv-elapsed{font:18px var(--rv-f-num);font-variant-numeric:tabular-nums;white-space:nowrap;text-shadow:1px 1px 0 var(--rv-ink)}
.rv-live-dot{width:8px;height:8px;background:#8a958e;flex:none}
.rv-live[aria-pressed=true]{background:var(--rv-live);color:#fff;box-shadow:inset 2px 2px 0 rgba(255,255,255,.3),inset -2px -2px 0 rgba(0,0,0,.35)}
.rv-live[aria-pressed=true] .rv-live-dot{background:#fff;animation:rv-pulse 1s steps(2) infinite}
@keyframes rv-pulse{50%{opacity:.2}}
.rv-center{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;text-align:center}
.rv-center-top{place-items:start center;padding-top:clamp(64px,13%,110px)}
.rv-count{padding:10px 20px 8px;background:rgba(15,42,29,.92);border:3px solid var(--rv-ink);box-shadow:inset 2px 2px 0 rgba(242,200,106,.45),inset -2px -2px 0 rgba(0,0,0,.4)}
.rv-count-k{font:10px var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.06em;color:var(--rv-brass2)}
.rv-count-v{font-family:var(--rv-f-num);font-size:44px;line-height:1;font-variant-numeric:tabular-nums}
.rv-photo{font-family:var(--rv-f-display);font-size:46px;font-weight:700;letter-spacing:.25em;padding:6px 8px 6px 20px;border:4px solid var(--rv-cream);color:var(--rv-cream);transform:rotate(-5deg);text-shadow:3px 3px 0 var(--rv-ink);background:rgba(122,31,31,.55);box-shadow:4px 4px 0 var(--rv-ink);animation:rv-stamp .25s steps(4)}
@keyframes rv-stamp{from{transform:rotate(-5deg) scale(1.6);opacity:0}}
.rv-badge-buffer{right:auto!important;left:12px;background:#8a958e!important}
.rv-minimap{position:absolute;left:10px;right:10px;bottom:54px;height:36px;width:calc(100% - 20px);border:2px solid var(--rv-ink);pointer-events:none;image-rendering:pixelated}
.rv-pip{position:absolute;pointer-events:none;border:3px solid var(--rv-ink);box-shadow:inset 0 0 0 2px var(--rv-brass),3px 3px 0 rgba(0,0,0,.45);margin:-3px}
.rv-pip span{position:absolute;left:4px;top:4px;font:9px var(--rv-f-pixel);text-transform:uppercase;background:var(--rv-brass);color:var(--rv-ink);padding:2px 4px}
.rv-badge{position:absolute;right:12px;bottom:92px;font:10px var(--rv-f-pixel);text-transform:uppercase;padding:5px 8px 4px;background:var(--rv-brass);color:var(--rv-ink);border:2px solid var(--rv-ink);pointer-events:none}
.rv-modal{position:absolute;left:0;right:0;top:0;bottom:52px;display:grid;place-items:center;padding:10px;background:rgba(8,21,14,.5);animation:rv-in .3s steps(3)}
.rv-card{width:min(440px,100%);max-height:100%;overflow:auto;background:var(--rv-green);border:3px solid var(--rv-ink);box-shadow:inset 2px 2px 0 rgba(242,200,106,.5),inset -2px -2px 0 rgba(0,0,0,.45),5px 5px 0 rgba(0,0,0,.45)}
.rv-card-h{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:12px 12px 8px 14px;position:sticky;top:0;background:var(--rv-green);border-bottom:2px solid var(--rv-ink)}
.rv-card-k{font:10px var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.06em;color:var(--rv-brass2)}
.rv-card-t{font-family:var(--rv-f-display);font-size:20px;font-weight:700;margin-top:3px;text-shadow:2px 2px 0 var(--rv-ink)}
.rv-card-s{font-size:12px;opacity:.8;margin-top:2px}
.rv-res{width:100%;border-collapse:collapse;font-size:13px}
.rv-res td{padding:6px 6px;border-top:2px solid rgba(11,15,12,.6);white-space:nowrap}
.rv-res td:first-child{padding-left:14px;font:18px var(--rv-f-num);width:38px;color:var(--rv-cream)}
.rv-res td:last-child{padding-right:14px;text-align:right;opacity:.85;font-weight:600}
.rv-res .rv-res-name{white-space:normal;font-weight:700}
.rv-res .rv-res-time{font:18px var(--rv-f-num);font-variant-numeric:tabular-nums;text-align:right}
.rv-res tr.rv-me td{background:rgba(217,164,65,.2)}
.rv-res tr.rv-win td:first-child{color:var(--rv-brass2)}
.rv-card-f{display:flex;gap:8px;justify-content:flex-end;padding:10px 12px 12px}
.rv-debug{position:absolute;right:8px;top:96px;font:600 10.5px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;padding:4px 6px;background:rgba(0,0,0,.65);color:#9fe39f;pointer-events:none;white-space:pre}
.rv-narrow .rv-hud{padding:8px 9px 14px;gap:5px}
.rv-narrow .rv-name{font-size:15px}
.rv-narrow .rv-chip{font-size:9px;padding:3px 5px 2px}
.rv-narrow .rv-time{font-size:26px}
.rv-narrow .rv-togo{font-size:9px}
.rv-narrow .rv-st{font-size:11px;padding:2px 6px 2px 2px}
.rv-narrow .rv-st-cand .rv-st-name{max-width:60px;overflow:hidden}
.rv-narrow .rv-standings .rv-st{flex:0 1 auto;min-width:0}
.rv-narrow .rv-standings .rv-st>*{flex:none}
.rv-narrow .rv-standings .rv-st-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.rv-standings .rv-st-more{flex:none}
.rv-narrow .rv-st-pos{font-size:15px}
.rv-narrow .rv-ticker{font-size:11.5px;padding:4px 8px 4px 6px}
.rv-ticker-low{position:absolute;left:8px;right:8px;bottom:86px;display:flex;pointer-events:none}
.rv-narrow .rv-controls{gap:3px;padding:12px 6px 6px}
.rv-narrow .rv-btn{min-width:32px;height:34px;padding:0 7px;font-size:10px}
.rv-narrow .rv-scrub{min-width:40px}
.rv-narrow .rv-range{min-width:28px}
.rv-narrow .rv-seg .rv-btn{padding:0 5px;gap:4px}
.rv-narrow .rv-elapsed{display:none}
.rv-narrow .rv-modal{bottom:46px;padding:6px}
.rv-narrow .rv-card-h{padding:9px 9px 6px 11px}
.rv-narrow .rv-card-t{font-size:16px}
.rv-narrow .rv-card-s{font-size:11px}
.rv-narrow .rv-res{font-size:12px}
.rv-narrow .rv-res td{padding:4px 4px}
.rv-narrow .rv-res td:first-child{padding-left:10px;width:30px;font-size:16px}
.rv-narrow .rv-res .rv-res-time{font-size:16px}
.rv-narrow .rv-res td:last-child{padding-right:10px}
.rv-narrow .rv-card-f{padding:8px 9px 9px}
.rv-narrow .rv-photo{font-size:30px}
.rv-narrow .rv-count{padding:6px 14px 5px}
.rv-narrow .rv-count-k{font-size:8.5px}
.rv-narrow .rv-count-v{font-size:30px}
.rv-narrow .rv-center-top{padding-top:96px}
.rv-narrow .rv-badge{bottom:72px}
.rv-whatif{position:absolute;left:12px;bottom:100px;z-index:3;font:11px var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.04em;padding:6px 9px 5px;background:#c8462f;color:var(--rv-cream);border:2px solid var(--rv-ink);box-shadow:2px 2px 0 rgba(0,0,0,.45);pointer-events:none}
.rv-narrow .rv-whatif{bottom:84px;left:8px;font-size:9.5px;padding:5px 7px 4px}
.rv-narrow .rv-minimap{bottom:48px;height:30px;left:6px;right:6px;width:calc(100% - 12px)}
.rv-narrow .rv-debug{bottom:auto;top:92px;font-size:9px}
.rv-cmap{position:absolute;right:10px;top:var(--rv-cmap-top,98px);width:176px;background:rgba(11,15,12,.78);border:2px solid var(--rv-ink);box-shadow:inset 1px 1px 0 rgba(242,200,106,.25),2px 2px 0 rgba(0,0,0,.35);pointer-events:auto}
.rv-cmap-tab{appearance:none;display:flex;align-items:center;gap:6px;width:100%;min-height:24px;padding:3px 6px 2px;background:var(--rv-green2);color:var(--rv-cream);border:0;border-bottom:2px solid var(--rv-ink);font:10px/1 var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.04em;cursor:pointer;text-align:left}
.rv-cmap-tab:focus-visible{outline:2px solid var(--rv-brass2);outline-offset:1px}
.rv-cmap-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rv-cmap-slope{flex:none;padding:2px 4px 1px;background:#e0902f;color:var(--rv-ink)}
.rv-cmap-down{background:#7fb6d9}
.rv-cmap-svg{width:100%;height:auto;max-height:124px;padding:4px}
.rv-cmap-shut{width:auto}
.rv-cmap-shut .rv-cmap-tab{border-bottom:0}
.rv-has-cmap .rv-debug{right:auto;left:8px}
.rv-narrow .rv-cmap{right:6px;top:var(--rv-cmap-top,84px);width:118px}
.rv-narrow .rv-cmap-tab{font-size:9px;min-height:22px;padding:2px 5px 1px;gap:4px}
.rv-narrow .rv-cmap-svg{padding:3px;max-height:70px}
.rv-dist{display:flex;align-items:stretch;justify-content:flex-end;gap:0;margin-top:4px}
.rv-dist-plate{display:grid;place-items:center;min-width:34px;padding:0 6px;font:13px/1 var(--rv-f-pixel);text-transform:uppercase;color:#fff;border:2px solid var(--rv-ink);border-right:0;text-shadow:1px 1px 0 rgba(0,0,0,.55)}
.rv-dist-plate-board{color:#1a1612;text-shadow:none}
.rv-dist-m{font-family:var(--rv-f-num);font-size:30px;line-height:1;padding:2px 8px 0;background:rgba(11,15,12,.82);border:2px solid var(--rv-ink);font-variant-numeric:tabular-nums;color:var(--rv-cream)}
.rv-dist-m small{font-size:15px;margin-left:2px;opacity:.75}
.rv-dist-ff .rv-dist-m{font-size:40px;color:var(--rv-brass2);padding:3px 10px 0}
.rv-ff .rv-name,.rv-ff .rv-chips{visibility:hidden}
.rv-call{display:flex;align-items:flex-start;gap:7px;align-self:flex-start;max-width:min(620px,94%);font-size:13.5px;font-weight:700;line-height:1.3;padding:5px 10px 5px 6px;background:rgba(11,15,12,.86);border:2px solid var(--rv-ink);border-left:4px solid var(--rv-brass);animation:rv-in .3s steps(3)}
.rv-call-k{flex:none;font:9px/1 var(--rv-f-pixel);text-transform:uppercase;color:var(--rv-ink);background:var(--rv-brass);padding:3px 4px 2px;margin-top:2px}
.rv-call-hot{border-left-color:var(--rv-live)}
.rv-call-hot .rv-call-k{background:var(--rv-live);color:#fff}
.rv-call-you{border-left-color:#7fc3ee}
.rv-narrow .rv-call{font-size:11.5px;padding:4px 8px 4px 5px}
.rv-battle{position:absolute;left:50%;bottom:58px;transform:translateX(-50%);display:flex;align-items:stretch;pointer-events:none;border:3px solid var(--rv-ink);box-shadow:3px 3px 0 rgba(0,0,0,.45);animation:rv-fade .25s steps(3)}
.rv-battle-k{display:grid;place-items:center;padding:0 9px;background:var(--rv-live);color:#fff;font:11px/1.1 var(--rv-f-pixel);text-transform:uppercase;text-align:center;letter-spacing:.04em}
.rv-battle-h{display:flex;align-items:center;gap:6px;padding:5px 10px;background:rgba(15,42,29,.94);border-left:2px solid var(--rv-ink);font-weight:800;font-size:14px;white-space:nowrap}
.rv-battle-h.rv-me{background:#3a2c0e;box-shadow:inset 0 0 0 2px var(--rv-brass)}
.rv-battle-gap{font:16px var(--rv-f-num);color:var(--rv-brass2)}
.rv-narrow .rv-battle{bottom:50px;max-width:calc(100% - 12px)}
.rv-narrow .rv-battle-h{font-size:11.5px;padding:4px 6px;gap:4px;min-width:0}
.rv-narrow .rv-battle-h span:not(.rv-swatch):not(.rv-battle-gap){overflow:hidden;text-overflow:ellipsis;max-width:78px}
.rv-narrow .rv-battle-k{font-size:9px;padding:0 6px}
.rv-fin{position:absolute;left:0;right:0;top:0;bottom:52px;cursor:pointer}
.rv-fin .rv-center{pointer-events:none}
.rv-fin-call{display:grid;justify-items:center;gap:12px}
.rv-fin-sub{font:11px var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.06em;padding:5px 9px 4px;background:rgba(11,15,12,.85);border:2px solid var(--rv-ink)}
.rv-fin-s-photograph{background:radial-gradient(ellipse at center,rgba(255,255,255,.18),rgba(8,21,14,.35) 70%)}
.rv-fin-s-strip{background:rgba(8,21,14,.55)}
.rv-fin-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(940px,calc(100% - 24px));max-height:calc(100% - 16px);overflow:auto;padding:10px 12px 12px;background:var(--rv-green);border:3px solid var(--rv-ink);box-shadow:inset 2px 2px 0 rgba(242,200,106,.5),inset -2px -2px 0 rgba(0,0,0,.45),5px 5px 0 rgba(0,0,0,.45);cursor:default;animation:rv-fade .3s steps(3)}
@keyframes rv-fade{from{opacity:0}}
.rv-fin-panel-h{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.rv-fin-k{font:11px var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.06em;color:var(--rv-brass2)}
.rv-fin-photo figcaption{font-size:16px!important;text-shadow:1px 1px 0 var(--rv-ink)}
.rv-fin-photo-n figcaption{display:none}
.rv-fin-verdict{font-weight:800;font-size:12.5px;line-height:1.3;margin:0 0 6px;min-height:2.6em;opacity:0;transition:opacity .4s}
.rv-fin-verdict-on{opacity:1}
.rv-fin-badges{position:absolute;left:12px;top:12px;display:flex;gap:6px;pointer-events:none}
.rv-fin-badge{font:11px var(--rv-f-pixel);text-transform:uppercase;padding:5px 8px 4px;background:var(--rv-brass);color:var(--rv-ink);border:2px solid var(--rv-ink)}
.rv-fin-badge-red{background:var(--rv-live);color:#fff;animation:rv-pulse 1.2s steps(2) infinite}
.rv-fin-lower{position:absolute;left:12px;bottom:10px;max-width:min(720px,calc(100% - 24px));display:grid;gap:3px;padding:7px 12px 8px;background:rgba(11,15,12,.86);border:2px solid var(--rv-ink);border-left:5px solid var(--rv-live);pointer-events:none}
.rv-fin-lower-k{font:10px var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.06em;color:var(--rv-brass2)}
.rv-fin-lower-t{font-weight:800;font-size:15px}
.rv-fin-weighed{display:grid;justify-items:center;gap:6px;padding:16px 28px 14px;background:var(--rv-green);border:3px solid var(--rv-ink);box-shadow:inset 0 0 0 3px #2f8a4c,6px 6px 0 rgba(0,0,0,.45);animation:rv-stamp .3s steps(4)}
.rv-fin-weighed-t{display:flex;align-items:center;gap:12px;font-family:var(--rv-f-display);font-size:40px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;text-shadow:3px 3px 0 var(--rv-ink)}
.rv-fin-tick{display:grid;place-items:center;width:40px;height:40px;background:#2f8a4c;border:3px solid var(--rv-ink);font-size:26px;text-shadow:none}
.rv-fin-weighed-s{font:12px var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.06em;color:var(--rv-brass2)}
.rv-fin-seal{font-size:12.5px;font-weight:700;opacity:.9;text-align:center;max-width:360px}
.rv-fin-seal-bad{color:#ffb4a8}
.rv-fin-slide{position:absolute;right:18px;justify-items:end;top:50%;transform:translateY(-50%);width:min(600px,47%);display:grid;gap:8px;cursor:pointer;animation:rv-slide-in .5s cubic-bezier(.2,.9,.25,1) both}
@keyframes rv-slide-in{from{opacity:0;transform:translate(80px,-50%)}to{opacity:1;transform:translate(0,-50%)}}
.rv-fin-card{display:flex;gap:16px;align-items:stretch;padding:12px;background:rgba(11,15,12,.9);border:3px solid var(--rv-ink);box-shadow:inset 0 0 0 2px rgba(242,200,106,.45),6px 6px 0 rgba(0,0,0,.45)}
.rv-fin-win .rv-fin-card{box-shadow:inset 0 0 0 3px var(--rv-brass2),0 0 0 3px rgba(242,200,106,.35),6px 6px 0 rgba(0,0,0,.45);background:linear-gradient(160deg,rgba(58,44,14,.95),rgba(11,15,12,.93) 60%)}
.rv-fin-mine .rv-fin-card{box-shadow:inset 0 0 0 3px #7fc3ee,6px 6px 0 rgba(0,0,0,.45)}
.rv-fin-portrait{position:relative;flex:none;display:grid;place-items:end center;overflow:hidden;background:radial-gradient(circle at 50% 38%,#3d6b4f,#163a28 70%);border:3px solid var(--rv-ink);box-shadow:inset 0 0 0 2px rgba(242,200,106,.4)}
.rv-fin-portrait>:first-child{width:100%!important;height:100%!important;display:block}
.rv-fin-portrait img{image-rendering:pixelated;object-fit:contain;object-position:bottom}
.rv-fin-place{position:absolute;left:0;top:0;font:30px/1 var(--rv-f-num);padding:4px 8px 2px;background:var(--rv-ink);color:var(--rv-brass2)}
.rv-fin-win .rv-fin-place{background:var(--rv-brass2);color:var(--rv-ink)}
.rv-fin-body{min-width:0;display:flex;flex-direction:column;justify-content:center;gap:6px}
.rv-fin-eyebrow{font:11px var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.08em;color:var(--rv-brass2)}
.rv-fin-win .rv-fin-eyebrow{font-size:14px;color:var(--rv-brass2);animation:rv-pulse 1.4s steps(2) 3}
.rv-fin-mine .rv-fin-eyebrow{color:#7fc3ee}
.rv-fin-name{font-family:var(--rv-f-display);font-size:30px;font-weight:700;line-height:1.05;text-shadow:2px 2px 0 var(--rv-ink);overflow-wrap:anywhere}
.rv-fin-stable{display:flex;align-items:center;gap:8px;font-weight:800;font-size:14px}
.rv-fin-stable-img{width:30px;height:30px;object-fit:cover;border:2px solid var(--rv-ink);flex:none}
.rv-fin-line{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;opacity:.85}
.rv-fin-silks{display:inline-block;flex:none;border:2px solid var(--rv-ink)}
.rv-fin-margin{font-weight:800;font-size:15px;color:var(--rv-cream)}
.rv-fin-time{font:24px/1 var(--rv-f-num);color:var(--rv-brass2);font-variant-numeric:tabular-nums}
.rv-fin-podium{display:flex;gap:6px;flex-wrap:wrap}
.rv-fin-pod{font-size:12px;font-weight:700;padding:3px 7px;background:rgba(11,15,12,.85);border:2px solid var(--rv-ink)}
.rv-fin-pod b{font-family:var(--rv-f-num);font-weight:400;font-size:15px;color:var(--rv-brass2);margin-right:2px}
.rv-fin-skip{position:absolute;right:10px;bottom:8px;display:flex;gap:6px}

.rv-fin-s-replay .rv-fin-skip{top:10px;bottom:auto}
.rv-narrow .rv-fin{bottom:46px}
.rv-narrow .rv-fin-slide{left:8px;right:8px;top:8px;bottom:auto;width:auto;transform:none;justify-items:stretch;animation-name:rv-slide-down}
.rv-narrow .rv-fin-podium{order:2}
@keyframes rv-slide-down{from{opacity:0;transform:translateY(-40px)}to{opacity:1;transform:none}}
@keyframes rv-slide-up{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:none}}
.rv-narrow .rv-fin-card{gap:10px;padding:8px}
.rv-narrow .rv-fin-name{font-size:19px}
.rv-narrow .rv-fin-place{font-size:22px;padding:3px 6px 1px}
.rv-narrow .rv-fin-body{gap:3px}
.rv-narrow .rv-fin-stable{font-size:12px;gap:6px}
.rv-narrow .rv-fin-stable-img{width:22px;height:22px}
.rv-narrow .rv-fin-line{font-size:11px}
.rv-narrow .rv-fin-margin{font-size:12.5px}
.rv-narrow .rv-fin-time{font-size:19px}
.rv-narrow .rv-fin-eyebrow{font-size:9.5px}
.rv-narrow .rv-fin-win .rv-fin-eyebrow{font-size:11px}
.rv-narrow .rv-fin-pod{font-size:10.5px;padding:2px 5px}
.rv-narrow .rv-fin-weighed{padding:10px 14px 9px;margin:0 8px}
.rv-narrow .rv-fin-weighed-t{font-size:26px;gap:8px}
.rv-narrow .rv-fin-tick{width:30px;height:30px;font-size:19px}
.rv-narrow .rv-fin-seal{font-size:11px}
.rv-narrow .rv-fin-panel{padding:7px 8px 8px;width:calc(100% - 12px);top:auto;bottom:6px;transform:translateX(-50%);max-height:calc(100% - 52px)}
.rv-narrow .rv-fin-s-strip .rv-fin-skip{top:6px;bottom:auto}
.rv-narrow .rv-fin-strip{display:flex;flex-direction:column;height:calc(100% - 52px);overflow:hidden}
.rv-narrow .rv-fin-strip .rv-fin-panel-h,.rv-narrow .rv-fin-strip .rv-fin-verdict{flex:none}
.rv-narrow .rv-fin-lower{left:6px;right:6px;top:46px;bottom:auto;max-width:none;padding:5px 8px 6px}
.rv-narrow .rv-fin-lower-t{font-size:12.5px}
.rv-narrow .rv-fin-badges{left:6px;top:8px}
.rv-narrow .rv-fin-badge{font-size:9.5px;padding:4px 6px 3px}
.rv-narrow .rv-fin-skip{right:6px;bottom:6px}

.rv-narrow .rv-dist-m{font-size:24px;padding:2px 6px 0}
.rv-narrow .rv-dist-ff .rv-dist-m{font-size:30px}
.rv-narrow .rv-dist-plate{min-width:28px;font-size:11px;padding:0 4px}
.rv-pre-paddock{position:absolute;inset:0;overflow:hidden;background:var(--rv-green);animation:rv-fade .3s steps(3)}
.rv-pre-field{list-style:none;margin:0;padding:18px 16px 110px;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px;align-content:center;height:100%;box-sizing:border-box}
.rv-pre-field li{display:flex;align-items:center;gap:7px;padding:5px 8px;background:rgba(11,15,12,.75);border:2px solid var(--rv-ink);font-weight:800;font-size:13px;min-width:0}
.rv-pre-field li.rv-me{box-shadow:inset 0 0 0 2px var(--rv-brass)}
.rv-pre-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rv-pre-cloth{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 3px;background:var(--rv-cream);color:var(--rv-ink);font:14px/1 var(--rv-f-num);border:2px solid var(--rv-ink);flex:none}
.rv-pre-lower{position:absolute;left:12px;bottom:64px;max-width:min(560px,calc(100% - 24px));display:grid;gap:3px;padding:7px 12px 8px;background:rgba(11,15,12,.86);border:2px solid var(--rv-ink);border-left:5px solid var(--rv-brass);pointer-events:none;animation:rv-fade .3s steps(3)}
.rv-pre-paddock-in{position:absolute;left:0;right:0;top:0;bottom:52px;overflow:hidden}
.rv-narrow .rv-pre-paddock-in{bottom:46px}
.rv-pre-lower.rv-pre-top{top:12px;bottom:auto}
.rv-narrow .rv-pre-lower.rv-pre-top{top:6px;bottom:auto}
.rv-pre-k{font:10px var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.06em;color:var(--rv-brass2)}
.rv-pre-t{display:flex;align-items:center;gap:7px;font-weight:800;font-size:15px;min-width:0}
.rv-pre-led{animation:rv-slide-up .25s steps(3)}
.rv-pre-led.rv-me{color:var(--rv-brass2)}
.rv-pre-count{position:absolute;right:12px;top:12px;display:grid;justify-items:end;padding:5px 10px 4px;background:rgba(15,42,29,.9);border:2px solid var(--rv-ink);pointer-events:none}
.rv-pre-count-k{font:9px var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.06em;color:var(--rv-brass2)}
.rv-pre-count-v{font-family:var(--rv-f-num);font-size:28px;line-height:1;font-variant-numeric:tabular-nums}
.rv-pre-skip{position:absolute;right:12px;bottom:64px}
.rv-pre-skip.rv-pre-skip-top{top:64px;bottom:auto}
.rv-narrow .rv-pre-skip.rv-pre-skip-top{top:52px;bottom:auto}
.rv-pre-on{position:absolute;right:12px;top:12px;opacity:.85}
.rv-narrow .rv-pre-lower{left:6px;right:auto;bottom:54px;max-width:calc(100% - 132px);padding:5px 8px 6px}
.rv-narrow .rv-pre-t{font-size:12.5px}
.rv-narrow .rv-pre-k{font-size:8.5px}
.rv-narrow .rv-pre-skip{right:6px;bottom:54px}
.rv-narrow .rv-pre-count{right:6px;top:6px;padding:4px 7px 3px}
.rv-narrow .rv-pre-count-v{font-size:22px}
.rv-narrow .rv-pre-field{grid-template-columns:1fr 1fr;padding:10px 8px 96px;gap:4px}
.rv-narrow .rv-pre-field li{font-size:11px;padding:3px 5px;gap:5px}
@media (prefers-reduced-motion: reduce){.rv-pre-paddock,.rv-pre-lower,.rv-pre-led,.rv-fin-slide,.rv-fin-panel,.rv-fin-weighed,.rv-battle,.rv-call{animation:none!important}.rv-fin-badge-red,.rv-fin-win .rv-fin-eyebrow{animation:none!important}}
`;

let injected = false;
export function injectViewerCss(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-race-viewer", "");
  el.textContent = VIEWER_CSS;
  document.head.appendChild(el);
}
