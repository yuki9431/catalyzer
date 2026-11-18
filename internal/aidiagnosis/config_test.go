package aidiagnosis

import "testing"

func TestParseAllowed(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want []string
	}{
		{"空", "", nil},
		{"1件", "0123456789abcdef", []string{"0123456789abcdef"}},
		{"空白と大文字を整える", " 0123456789ABCDEF , fedcba9876543210 ", []string{"0123456789abcdef", "fedcba9876543210"}},
		{"不正は捨てる", "short,0123456789abcdeg,0123456789abcdef0,0123456789abcdef", []string{"0123456789abcdef"}},
		{"空要素", ",,0123456789abcdef,", []string{"0123456789abcdef"}},
	}
	for _, tt := range tests {
		got := parseAllowed(tt.in)
		if len(got) != len(tt.want) {
			t.Errorf("%s: %v, want %v", tt.name, got, tt.want)
			continue
		}
		for _, k := range tt.want {
			if !got[k] {
				t.Errorf("%s: %q が無い: %v", tt.name, k, got)
			}
		}
	}
}
