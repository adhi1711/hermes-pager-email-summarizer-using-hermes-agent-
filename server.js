const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({
        message: "Hermes Email Summarizer backend is running!"
    });
});

app.post("/summarize", async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                error: "Email text is required"
            });
        }

        const response = await fetch(
            "http://127.0.0.1:8642/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer hermes-local-dev-key"
                },
                body: JSON.stringify({
                    model: "hermes-agent",
                    messages: [
                        {
                            role: "user",
                            content: `Analyze this email and return a concise summary.

Email:
${email}`
                        }
                    ]
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: "Hermes API error",
                details: data
            });
        }

        res.json({
            summary: data.choices[0].message.content
        });

    } catch (error) {
        console.error("Error:", error);

        res.status(500).json({
            error: "Failed to communicate with Hermes"
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});