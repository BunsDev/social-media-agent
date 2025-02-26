import { z } from "zod";
import { IngestRepurposedDataState, RepurposedContent } from "./types.js";
import { ChatAnthropic } from "@langchain/anthropic";
import { isValidUrl } from "../utils.js";

const EXTRACT_CONTENT_PROMPT = `You're a helpful AI assistant, tasked with extracting content from a Slack message.

<context>
The Slack message will contain link(s) to content which our company (LangChain) wants to post about.
To generate a post, we need at a minimum, one link to the original content.
Additionally, users can send followup links to be used as "additional contexts".
Lastly, they can provide a "quantity" number, indicating how many posts to generate. They do not need to supply this, as we'll set the default to 2.
</context>

<extraction-fields-context>
The content you need to extract is as follows:
- "original_link" This is the main link to use to generate content. If there is only one link provided, it will be used as the original link.
- "additional_contents" These are any followup links provided by the user. This is not required and can be left blank.
- "quantity" This is the number of posts to generate. If not provided, we'll default to 2.
</extraction-fields-context>

<instructions>
- Examine the message closely, and determine which links should be extracted and set in the proper fields.
- If no links are provided, you should set the "original_link" field to "NO_LINKS_PROVIDED"
</instructions>

Here is the Slack message:
<slack-message>
{SLACK_MESSAGE}
</slack-message>
`;

const DEFAULT_POST_QUANTITY = 2;

const extractionSchema = z.object({
  original_link: z
    .string()
    .describe(
      "The main link to use to generate content. Set to 'NO_LINKS_PROVIDED' if none provided.",
    ),
  additional_contents: z
    .array(z.string())
    .describe("Any followup links provided by the user.")
    .optional(),
  quantity: z
    .number()
    .describe(
      "The number of posts to generate. Defaults to 2 if no quantity specified in the message.",
    )
    .default(DEFAULT_POST_QUANTITY),
});

export async function extract(
  state: IngestRepurposedDataState,
): Promise<Partial<IngestRepurposedDataState>> {
  const model = new ChatAnthropic({
    model: "claude-3-7-sonnet-latest",
    temperature: 0,
  }).bindTools(
    [
      {
        name: "extract_content",
        description: "Extract content from a Slack message.",
        schema: extractionSchema,
      },
    ],
    {
      tool_choice: "extract_content",
    },
  );

  const extractedContents: RepurposedContent[] = [];

  for await (const message of state.messages) {
    const messageText = message.text;
    const formattedPrompt = EXTRACT_CONTENT_PROMPT.replace(
      "{SLACK_MESSAGE}",
      messageText,
    );

    const result = await model.invoke(formattedPrompt);
    const args = result.tool_calls?.[0]?.args as z.infer<
      typeof extractionSchema
    >;

    if (isValidUrl(args?.original_link)) {
      extractedContents.push({
        originalLink: args?.original_link,
        additionalContextLinks: args?.additional_contents,
        quantity: args?.quantity ?? DEFAULT_POST_QUANTITY,
      });
    }
  }

  return {
    contents: extractedContents,
  };
}
