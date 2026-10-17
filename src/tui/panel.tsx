import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { theme } from "./theme.js";

// A bordered box with its title written into the top edge: ╭─ [2] Tables ───╮
// `height` counts the title line and the bottom border, so content gets height - 2 lines.
export function Panel(props: {
  title: string;
  width: number;
  height: number;
  focused?: boolean;
  children?: ReactNode;
}) {
  const color = props.focused ? theme.accent : theme.border;
  const title = props.title.length > props.width - 6 ? `${props.title.slice(0, props.width - 7)}…` : props.title;
  const dashes = "─".repeat(Math.max(0, props.width - title.length - 5));

  return (
    <Box flexDirection="column" width={props.width} height={props.height} flexShrink={0}>
      <Text color={color}>
        {"╭─ "}
        <Text bold color={props.focused ? theme.accent : undefined}>
          {title}
        </Text>
        {` ${dashes}╮`}
      </Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderTop={false}
        borderColor={color}
        paddingX={1}
        width={props.width}
        height={props.height - 1}
        overflow="hidden"
      >
        {props.children}
      </Box>
    </Box>
  );
}
