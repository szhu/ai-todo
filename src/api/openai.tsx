export async function getChatCompletion(messageText: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + localStorage.OPENAI_API_KEY,
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo-1106",
      // response_format: { type: "json_object" },
      messages: [{ role: "user", content: messageText }],
      temperature: 0.7,
    }),
  });

  const json = await response.json();
  if (json?.error?.message) {
    throw new Error("OpenAI API Error: " + json?.error?.message);
  }

  return json.choices[0].message.content;
}
