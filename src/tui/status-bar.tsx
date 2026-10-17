import { Box, Text } from "ink";
import { theme } from "./theme.js";

// Bottom line, lazydocker style: "key: action" hints, or the text being typed, or an error.
export function StatusBar(props: {
  hints: [key: string, action: string][];
  prompt?: string;
  error?: string;
}) {
  return (
    <Box>
      {props.error ? (
        <Text color={theme.error} wrap="truncate-end">
          {props.error}
        </Text>
      ) : props.prompt !== undefined ? (
        <Text wrap="truncate-end">
          <Text color={theme.accent}>{props.prompt}</Text>█
        </Text>
      ) : (
        <Text wrap="truncate-end">
          {props.hints.map(([key, action], i) => (
            <Text key={key}>
              {i > 0 ? "  " : ""}
              <Text bold color={theme.accent}>
                {key}
              </Text>
              <Text dimColor>{`: ${action}`}</Text>
            </Text>
          ))}
        </Text>
      )}
    </Box>
  );
}
