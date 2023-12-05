import { css } from "@emotion/css";
import React = require("react");

const SingleLineTextInput = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<"textarea">
>((props, ref) => {
  return (
    <textarea
      ref={ref}
      rows={1}
      {...props}
      className={css`
        background: none;
        border: none;

        white-space: nowrap;
        resize: none;

        scrollbar-width: none;
        &::-webkit-scrollbar {
          display: none;
        }

        &:focus {
          outline: none;
        }

        ${props.className};
      `}
    />
  );
});

export default SingleLineTextInput;
