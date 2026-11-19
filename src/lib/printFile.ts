/**
 * Opens the printer for a PDF made or fetched on this device (Andy, 2026-11-19: Print buttons). On a computer
 * the print box opens straight away; where a browser can't print from the page (most phones), the PDF opens in
 * a new tab to print from there.
 */
export function printFile(file: File) {
  const url = URL.createObjectURL(file);
  const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (phone) {
    const w = window.open(url, '_blank');
    if (!w) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
    return;
  }
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.src = url;
  frame.onload = () => {
    try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } catch { window.open(url, '_blank'); }
    setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 120_000);
  };
  document.body.appendChild(frame);
}
