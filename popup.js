/* ────────────────────────────────────────────────────────────
 *  Unity Sales Viewer – Chrome Extension
 *  © 2025  Limitless Unity Development
 *  Licensed under the MIT License
 *  https://opensource.org/licenses/MIT
 *
 *  This extension is in no way affiliated with, authorized,
 *  maintained, sponsored or endorsed by Unity Technologies
 *  or any of its affiliates or subsidiaries.
 ──────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
    const refreshBtn = document.getElementById("refreshBtn");
    const totalGross = document.getElementById("totalGross");
    const totalRevenue = document.getElementById("totalRevenue");
    const salesTBody = document.querySelector("#salesTable tbody");
    const reviewsList = document.querySelector(".reviews-list");
    const tabs = [...document.querySelectorAll(".tab")];
    const panels = [...document.querySelectorAll("[data-panel]")];
    const zones = document.querySelectorAll(".zone");
    const tooltip = document.getElementById('tooltip');

    const verifyInvoiceBtn = document.getElementById("verifyInvoiceBtn");
    const invoiceInput = document.getElementById("invoiceInput");
    const verificationIndicator = document.getElementById("verificationIndicator");
    const invoicesTable = document.getElementById("invoicesTable");
    const invoicesTBody = document.querySelector("#invoicesTable tbody");

    let expectedGross = 0;
    let expectedNet = 0;
    const raw = localStorage.getItem("theme") || "auto";
    showIcon(raw);
    // Tab switching
    function switchTo(tabName) {
        tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tabName));
        panels.forEach(p => p.style.display = p.dataset.panel === tabName ? "" : "none");
    }

    tabs.forEach(t => t.addEventListener("click", () => switchTo(t.dataset.tab)));

    setTooltip(zones[0], () => `Expected In Month: ${expectedGross}`);
    setTooltip(zones[1], () => `Expected In Month: ${expectedNet}`);

    // Load cached or fetch fresh on open
    chrome.runtime.sendMessage({type: "GET_CACHED_SALES"}, r => {
        r.success ? renderSales(r.data) : fetchSales();
    });
    chrome.runtime.sendMessage({type: "GET_CACHED_REVIEWS"}, r => {
        r.success ? renderReviews(r.data) : fetchReviews();
    });

    fetchDailySales();

    // Refresh button
    refreshBtn.addEventListener("click", () => {
        const active = document.querySelector(".tab.active").dataset.tab;
        active === "reviews" ? fetchReviews() : fetchSales();
    });

    verifyInvoiceBtn.addEventListener("click", () => {
        const invoices = invoiceInput.value.split(",").map(s => s.trim()).filter(n => n);
        if (invoices.length === 0) {
            alert("Please enter at least one invoice number.");
            return;
        }
        verificationIndicator.style.display = "";
        invoicesTable.style.display = "none";

        chrome.runtime.sendMessage({type: "VERIFY_INVOICES", invoices}, res => {
            invoicesTBody.innerHTML = "";
            verificationIndicator.style.display = "none";
            if (!res.success) {
                return;
            }

            const list = res.data;
            list.forEach(r => {
                const tr = invoicesTBody.insertRow();

                const packageName = document.createElement("a");
                packageName.textContent = r.package_name;
                packageName.href = `https://assetstore.unity.com/packages/slug/${r.package_id}`;
                packageName.target = "_blank";

                let actions = document.createElement("div");
                if (r.reason === "Downloaded") {
                    const refund = document.createElement("button");
                    refund.textContent = "Refund";

                    const subject = r.package_name + " Refund";
                    const body = `Hello.

Please make a refund to the customer.

Asset: ${r.package_name}
Invoice Number: ${r.invoice}`;

                    refund.onclick = () => {
                        if (confirm("Are you sure you want to request a refund for this client?\n" +
                            "If yes, please make sure you are emailing from the correct account.")) {
                            window.open(`mailto:support@unity3d.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
                        }
                    }

                    actions.appendChild(refund);
                }

                [
                    r.invoice,
                    packageName,
                    r.quantity,
                    r.price + " " + r.currency,
                    r.date,
                    r.reason,
                    actions
                ].forEach(v => {
                    const td = tr.insertCell();
                    if (v instanceof Element) {
                        td.appendChild(v);
                    } else {
                        td.textContent = v;
                    }
                });
            });
            invoicesTable.style.display = "";
        });
    });

    // Clear badge count and mark notifications read when popup opens (Fix #5)
    chrome.runtime.sendMessage({type: "CLEAR_BADGE"});

    function fetchSales() {
        clearSales();
        chrome.runtime.sendMessage({type: "FETCH_SALES"}, res => {
            res.success ? renderSales(res.data) : alert("Sales fetch failed");
        });
    }

    function fetchDailySales() {
        chrome.runtime.sendMessage({type: "GET_CACHED_DAILY_SALES"}, res => {
            if (res.success) {
                // Only render cached data if it has current-month entries
                const now = new Date();
                const anyCurrentMonth = Object.keys(res.data || {}).some(key => {
                    const d = new Date(key);
                    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                });
                if (anyCurrentMonth) {
                    renderSalesChart(res.data);
                }
            }
            // Always fetch fresh data
            chrome.runtime.sendMessage({type: "FETCH_DAILY_SALES"}, res => {
                res.success ? renderSalesChart(res.data) 
                            : console.warn("Daily sales fetch failed");
            });
        });
    }

    function fetchReviews() {
        clearReviews();
        chrome.runtime.sendMessage({type: "FETCH_REVIEWS"}, res => {
            res.success ? renderReviews(res.data) : alert("Reviews fetch failed");
        });
    }

    function renderSales(list) {
        clearSales();
        const monthEl = document.querySelector(".sales-month");
        monthEl.textContent = new Date().toLocaleString("en-US", { month: 'long', year: 'numeric' });
    
        list.sort((a, b) => new Date(b.last) - new Date(a.last));
    
        let grossSum = 0, revSum = 0;
        console.log(list)
        list.forEach(r => {
            const tr = salesTBody.insertRow();
    
            // 1) Name cell with link
            const nameTd = tr.insertCell();
            const link   = document.createElement('a');
            link.href    = `https://assetstore.unity.com/packages/slug/${r.package_id}`;
            link.target  = '_blank';
            link.textContent = r.name;
            nameTd.appendChild(link);
    
            // 2) The rest of the columns
            [
                money(r.price),
                money(r.gross),
                money(r.revenue),
                Number(r.sales) - Number(r.refunds),
                pretty(r.last),
                pretty(r.first),
            ].forEach(txt => {
                const td = tr.insertCell();
                td.textContent = txt;
            });
    
            grossSum += num(r.gross);
            console.log(grossSum + "   " + r.gross);
            revSum   += num(r.revenue);
        });
    
        totalGross.textContent   = money(grossSum.toFixed(2));
        totalRevenue.textContent = money(revSum.toFixed(2));
    
        // Projected totals
        const now         = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysPassed  = now.getDate();
        const grossPerDay = grossSum / daysPassed;
        const expected    = grossPerDay * daysInMonth;
    
        expectedGross = money(Math.round(expected).toFixed(2));
        expectedNet   = money(Math.round(expected * 0.7).toFixed(2));
    
        chrome.action.setTitle({
            title: `Unity Sales:\n💰 Gross: ${totalGross.textContent}\n🏦 Net: ${totalRevenue.textContent}\n\n📈 Expected:\nGross: ${expectedGross}\nNet: ${expectedNet}`
        });
    }
    

    function renderSalesChart(data) {
        const now = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    
        // Initialize array of objects for each day
        const salesByDay = Array.from({ length: daysInMonth }, () => ({
            gross: 0, sales: 0, refunds: 0, chargebacks: 0,
            downloads: 0, page_views: 0, quick_looks: 0,
            wishlisted: 0, carted: 0, free_obtained: 0, count_ratings: 0,
            height: 0
        }));
        let maxHeight = 0;
    
        // Fill in data from API (keys are date strings)
        for (let key in data) {
            const v = data[key];
            const day = new Date(key).getDate() - 1;  // zero-based index
            v.height = Math.max(v.gross || 0, 0);
            maxHeight = Math.max(maxHeight, v.height);
            salesByDay[day] = v;
        }
    
        const chart = document.getElementById('chart');
        chart.innerHTML = '';  // clear previous bars
    
        const chartWidth = chart.clientWidth;
        const chartHeight = chart.clientHeight;
        const barWidth = chartWidth / daysInMonth;
    
        for (let i = 0; i < daysInMonth; i++) {
            const v = salesByDay[i];
            const bar = document.createElement('div');
            bar.classList.add('bar');
            bar.style.left = `${i * barWidth}px`;
            bar.style.width = `${barWidth - 1}px`;
    
            // Top label (e.g. "1st:", "2nd:" is an improvement, though originally "1th:")
            let tooltip = `${prettyDate(i + 1)}:`;
    
            // Add Gross/Net if any
            if (v.gross) {
                tooltip += `<br/>Gross: ${money(v.gross.toFixed(2))}`;
                tooltip += `<br/>Net: ${money((v.gross * 0.7).toFixed(2))}`;
            }
    
            // Always add Sales (0 if none)
            tooltip += `<br/>Sales: ${v.sales || 0}`;
    
            // Add other metrics only if present
            if (v.refunds) tooltip += `<br/>Refunds: ${v.refunds}`;
            if (v.chargebacks) tooltip += `<br/>Chargebacks: ${v.chargebacks}`;
            if (v.downloads) tooltip += `<br/>Downloads: ${v.downloads}`;
            if (v.page_views) tooltip += `<br/>Page Views: ${v.page_views}`;
            if (v.quick_looks) tooltip += `<br/>Quick Looks: ${v.quick_looks}`;
            if (v.wishlisted) tooltip += `<br/>Wishlisted: ${v.wishlisted}`;
            if (v.carted) tooltip += `<br/>Carted: ${v.carted}`;
            if (v.free_obtained) tooltip += `<br/>Free Obtained: ${v.free_obtained}`;
            if (v.count_ratings) tooltip += `<br/>Ratings: ${v.count_ratings}`;
    
            setTooltip(bar, () => tooltip);
    
            const barSegment = document.createElement('div');
            barSegment.classList.add('bar-segment');
            // Safe height calculation
            const heightPx = maxHeight > 0 ? (v.height / maxHeight) * chartHeight : 0;
            barSegment.style.height = `${heightPx}px`;
    
            bar.appendChild(barSegment);
            chart.appendChild(bar);
        }
    }

    function setTooltip(el, callback){
        el.addEventListener('mouseenter', (e) => {
            tooltip.innerHTML = callback();
            tooltip.style.display = 'block';
        });
        el.addEventListener('mousemove', (e) => {
            const px = Math.min(Math.max(e.pageX - tooltip.offsetWidth / 2, 0), window.innerWidth - tooltip.offsetWidth);
            tooltip.style.left = `${px}px`;
            tooltip.style.top = `${e.pageY + 30}px`;
        });
        el.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    }

    // Render reviews table with ★, subject, full text. now looks better)
    function renderReviews(list) {
        clearReviews();
        list.forEach(r => {
            const review = document.createElement("div");
            review.className = "review-card";
    
            const stars = "★".repeat(r.rating) + "✰".repeat(5 - r.rating);
    
            review.innerHTML = `
                <div class="review-header">
                    <a href="https://assetstore.unity.com/packages/slug/${r.packageId}#reviews" class="asset-name" target="_blank">${r.packageName}</a>
                    <span class="review-date">${(r.createdTime || "").slice(0,10)}</span>
                    <span class="review-rating">${stars}</span>
                </div>
                <div class="review-subject">${r.subject || "No Subject"}</div>
                <div class="review-text">${r.body || "No review text"}</div>
            `;
            reviewsList.appendChild(review);
        });
    }
    
    

    const wrapDiv = (text, params) => {
        const el = document.createElement("div");
        let textTarget = el;

        if (params.className) el.className = params.className;
        if (params.id) el.id = params.id;

        if (params.href) {
            const link = document.createElement("a");
            link.href = params.href;
            link.target = "_blank";
            el.appendChild(link);
            textTarget = link;
        }

        textTarget.textContent = text;

        return el;
    }

    // Helpers
    const num = s => parseFloat((s || "").replace(/[^-\d.]/g, "")) || 0;
    const money = s => `$${s || "0.00"}`;
    const pretty = s => s ? `${prettyDate(s.slice(8, 10))} at ${s.slice(11, 16)}` : "";
    const prettyDate = s => {
        const n = Number(s);
        return n + ["th","st","nd","rd"][(n % 10 > 3) ? 0 : (n - n % 10 !== 10) * (n % 10 < 4 ? n % 10 : 0)];
    };

    function clearSales() {
        salesTBody.innerHTML = "";
        totalGross.textContent = totalRevenue.textContent = "–";
    }

    function clearReviews() {
        reviewsList.innerHTML = "";
    }

    // Ensure CSRF: silently open/close a tab to refresh cookie if missing
    function ensureCsrf() {
        return new Promise(res => {
            chrome.cookies.get({url: "https://publisher.unity.com", name: "_csrf"}, c => {
                if (c) return res();
                chrome.tabs.create({url: "https://publisher.unity.com/sales", active: false}, tab => {
                    setTimeout(() => chrome.tabs.remove(tab.id, res), 2000);
                });
            });
        });
    }

     const themeToggle = document.getElementById("themeToggle");
     const htmlEl = document.documentElement;
     const modes  = ["light","dark","auto"];
     function showIcon(rawMode) {
        // assume your SVGs have these classes:
        //   .icon-light, .icon-dark, .icon-auto
        document.querySelectorAll('#themeToggle .icon').forEach(el => {
          el.style.opacity = '0';
        });

        const label = rawMode[0].toUpperCase() + rawMode.slice(1).toLowerCase();
        const toggle = document.getElementById("themeToggle");
        toggle.setAttribute("title", `Theme: ${label}`);
        // show only the one matching the *raw* selection
        const keep = document.querySelector(`#themeToggle .icon-${rawMode}`);
        if (keep) keep.style.opacity = '1';
        
      }

     // apply saved mode (default to auto)
     const saved = localStorage.getItem("theme") || "auto";
     htmlEl.setAttribute("data-theme", saved);
    
     themeToggle.addEventListener("click", () => {
       // cycle through light → dark → auto → light …
       const current = htmlEl.getAttribute("data-theme") || "auto";
       const idx     = modes.indexOf(current);
       const next    = modes[(idx + 1) % modes.length];
       htmlEl.setAttribute("data-theme", next);
       localStorage.setItem("theme", next);
       showIcon(next);
     });

});
document.getElementById('openPortalBtn').addEventListener('click', () => {
    const activeTab = document.querySelector('.tab.active').dataset.tab;
    const url = activeTab === 'reviews'
        ? 'https://publisher.unity.com/reviews'
        : 'https://publisher.unity.com/sales';

    chrome.tabs.create({url});
});


