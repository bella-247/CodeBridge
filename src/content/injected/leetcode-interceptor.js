(function() {
    const trustedOrigin = window.location.origin;
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await Reflect.apply(originalFetch, this, args);
        try {
            const url = response.url;
            // Pattern: /submissions/detail/<id>/check/
            if (url && url.includes("/submissions/detail/") && url.includes("/check/")) {
                const clone = response.clone();
                clone.json().then(data => {
                    if (data.state === "SUCCESS") {
                        window.postMessage({
                            type: "CODEBRIDGE_LEETCODE_SUBMISSION",
                            payload: data
                        }, trustedOrigin);
                    }
                }).catch(() => {});
            }
        } catch (e) {
            // ignore
        }
        return response;
    };
})();