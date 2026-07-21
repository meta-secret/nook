# Extract sealed-image unified diffs from mixed Task/Docker chatter.
# Prints only host-applicable patch lines.
BEGIN { in_diff = 0 }
/^diff --git / { in_diff = 1 }
in_diff {
  if ($0 ~ /^(diff --git |index |old mode |new mode |deleted file mode |new file mode |similarity index |rename |--- |\+\+\+ |@@ |[+\- ]|\\ |Binary files )/ || $0 == "") {
    print
    next
  }
  in_diff = 0
}
