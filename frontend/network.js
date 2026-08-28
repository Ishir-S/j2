export function initNetwork() {
    const networkBtn = document.getElementById("networkBtn");
    const networkPanel = document.getElementById("networkPanel");
    const localNodeDisplay = document.getElementById("localNodeDisplay");
    const toggleRoleBtn = document.getElementById("toggleRoleBtn");
    const networkDevicesList = document.getElementById("networkDevicesList");
    
    if (!networkBtn || !networkPanel) return;

    networkBtn.addEventListener("click", () => {
        // Toggle Panel
        const isActive = networkPanel.classList.contains("active");
        
        // Hide all others
        document.querySelectorAll(".panel-hidden").forEach(p => p.classList.remove("active"));
        
        if (!isActive) {
            networkPanel.classList.add("active");
            refreshNetworkData();
        }
    });
    
    toggleRoleBtn.addEventListener("click", async () => {
        const currentRole = localNodeDisplay.dataset.role || "CLIENT";
        const newRole = currentRole === "HOST" ? "CLIENT" : "HOST";
        try {
            const res = await fetch("/api/devices/role", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: newRole })
            });
            if(res.ok) {
                refreshNetworkData();
            }
        } catch(e) {
            console.error(e);
        }
    });
    
    // Auto-refresh network when panel is open
    setInterval(() => {
        if (networkPanel.classList.contains("active")) {
            refreshNetworkData();
        }
    }, 5000);
    
    async function refreshNetworkData() {
        try {
            const res = await fetch("/api/devices");
            const data = await res.json();
            
            // Update Local
            const loc = data.local;
            localNodeDisplay.dataset.role = loc.role;
            localNodeDisplay.innerHTML = `
                <div><strong>ID:</strong> ${loc.device_id.split("-")[0]}...</div>
                <div><strong>Name:</strong> ${loc.name}</div>
                <div><strong>Role:</strong> <span style="color: ${loc.role === 'HOST' ? 'cyan' : 'gray'}">${loc.role}</span></div>
            `;
            toggleRoleBtn.textContent = loc.role === "HOST" ? "BECOME CLIENT" : "BECOME HOST";
            
            // Update Network
            networkDevicesList.innerHTML = "";
            const devices = Object.values(data.network);
            if (devices.length === 0) {
                networkDevicesList.innerHTML = "<li>No other devices found on local network.</li>";
            } else {
                devices.forEach(d => {
                    const li = document.createElement("li");
                    li.style.borderBottom = "1px solid rgba(0,255,255,0.2)";
                    li.style.padding = "5px 0";
                    li.innerHTML = `
                        <div><strong>${d.name}</strong> (${d.ip})</div>
                        <div>Role: ${d.role} | Trust: ${d.trust_level}</div>
                    `;
                    networkDevicesList.appendChild(li);
                });
            }
        } catch (e) {
            console.error(e);
            localNodeDisplay.textContent = "Error loading network data.";
        }
    }
}
