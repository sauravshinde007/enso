import Groq from 'groq-sdk';
import dotenv from 'dotenv';
dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const transcriptText = `Saurav: Good morning everyone,

I want to take a couple of minutes to reflect on what makes our remote organization truly special. We may be working from different cities, different countries, and different time zones, but what connects us is much stronger than what separates us. We’re united by shared goals, shared accountability, and a shared commitment to delivering meaningful results.

In a remote environment, communication is not just important — it’s everything. Clarity replaces assumptions. Proactive updates replace uncertainty. And trust replaces micromanagement. Every time we document properly, respond thoughtfully, or offer help before being asked, we strengthen our culture.

Remote work also gives us something powerful: ownership. We manage our time, our priorities, and our outcomes. That flexibility is a privilege, but it also comes with responsibility. When each of us takes ownership of our work, stays aligned with team objectives, and remains transparent about progress and challenges, the entire organization moves forward smoothly.

Let’s also remember the human side of remote work. Behind every screen is a person — someone balancing tasks, deadlines, and life outside of work. A little empathy, patience, and appreciation go a long way. Collaboration thrives when people feel respected and supported.`;

const prompt = `Please generate Minutes of Meeting (MOM) for the following transcript. Summarize key points, action items, and decisions made. Return the MOM formatted cleanly in Markdown.\n\nTranscript:\n${transcriptText}`;

(async () => {
  const groqRes = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant',
  });
  console.log(groqRes.choices[0]?.message?.content);
})();
