/ Clean Sheets AI - Vercel API
// API key is stored safely in Vercel environment variables

module.exports = async (req, res) => {

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { data } = req.body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      res.status(400).json({ success: false, error: 'No data provided' });
      return;
    }

    // API key safely stored in Vercel env
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      res.status(500).json({ success: false, error: 'API key not configured' });
      return;
    }

    console.log('Analyzing', data.length, 'cells');

    // Build prompt with column headers as context
    const maxCells = 200;
    const limited  = data.slice(0, maxCells);

    let prompt = 'Analyze this Google Sheets data. Format: address [column]: value\n\n';
    limited.forEach(cell => {
      const headerHint  = cell.header     ? ' [' + cell.header + ']'              : '';
      const formulaHint = cell.wasFormula ? ' [extracted from broken formula]'    : '';
      prompt += cell.address + headerHint + formulaHint + ': "' + cell.value + '"\n';
    });

    if (data.length > maxCells) {
      prompt += '\n(Showing first ' + maxCells + ' of ' + data.length + ' cells)';
    }

    const systemPrompt = `You are a data cleaning expert for spreadsheets. Find ALL issues and suggest fixes.

STRICT RULES - must follow every time:
1. ALWAYS fix phone numbers to format 8(XXX)XXX-XX-XX for Russian numbers, or standard local format for others
2. ALWAYS trim extra spaces (leading, trailing, double spaces inside)
3. ALWAYS fix name capitalization → "John Smith" (not "john smith" or "JOHN SMITH")
4. ALWAYS lowercase emails → ivan@mail.ru (not IVAN@MAIL.RU)
5. ALWAYS normalize dates → DD.MM.YYYY
6. Use the column header as a hint about the data type
7. Cells marked [extracted from broken formula] — treat as regular data and fix normally
8. DO NOT skip obvious issues — check every single cell

Return ONLY a valid JSON array, no text before or after, no markdown:
[{"row":3,"col":2,"type":"Phone format","oldValue":"+7999123","newValue":"8(999)123-45-67","confidence":0.98}]

If no issues found, return [].`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'https://sheets.google.com',
        'X-Title':       'Clean Sheets AI',
      },
      body: JSON.stringify({
        model:       'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: prompt },
        ],
        temperature: 0.1,
        max_tokens:  4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter error:', errorText);
      throw new Error('OpenRouter API error: ' + response.status);
    }

    const result     = await response.json();
    const aiResponse = result.choices[0].message.content;
    console.log('AI response:', aiResponse);

    // Parse JSON response
    let issues = [];
    try {
      const jsonText = aiResponse.replace(/```json\n?|\n?```/g, '').trim();
      issues = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Parse error:', parseError);
      console.error('AI response was:', aiResponse);
      issues = [];
    }

    // Only confident fixes
    const filtered = issues.filter(i => !i.confidence || i.confidence > 0.7);
    console.log('Issues found:', filtered.length);

    res.status(200).json({
      success: true,
      issues:  filtered,
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      success: false,
      error:   error.message,
    });
  }
};
