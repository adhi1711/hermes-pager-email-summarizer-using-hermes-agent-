async function testHermes() {
    const response = await fetch("http://127.0.0.1:8642/v1/models", {
        headers: {
            "Authorization": "Bearer hermes-local-dev-key"
        }
    });

    console.log("Status:", response.status);

    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
}

testHermes();