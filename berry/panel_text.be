# panel_text.be -- what the keyboard types, read as places and sizes.
#
# The keyboards have letters, digits, space, period and a comma, so a slot is read leniently: two numbers make a place, whatever
# is between them, and "2,3", "l2c3" and "2x3" all mean the same place. One
# number alone, "23", is none. A zone's size is its grid, written as its last
# slot, so the same reading serves both.
#
# Static functions only: the store, the plan and the views all read a slot the
# same way (panel_store.be, panel_plan_view.be, panel_ui.be).

#@ solidify:PanelText
class PanelText
    static def is_digit(c)
        import string
        var b = string.byte(c)
        return b >= 48 && b <= 57
    end

    # every run of digits in the text, as ints
    static def numbers(text)
        var nums = []
        var run = ""
        for i: 0 .. size(text) - 1
            var c = text[i]
            if PanelText.is_digit(c)
                run += c
            elif size(run) > 0
                nums.push(int(run))
                run = ""
            end
        end
        if size(run) > 0 nums.push(int(run)) end
        return nums
    end

    # Every place in the text, [row, col] from 1: the screen's own row and
    # column. One per space-separated token of exactly two
    # numbers, so "2,5", "2.5" and "2x5" are the same place. Nil if a token is
    # anything else, or a place comes
    # twice.
    static def parse_places(text)
        var places = []
        var token = ""
        var i = 0
        var n = size(text)
        while i <= n
            var c = i < n ? text[i] : " "
            var sep = (c == " " || c == ";" || c == "\t" || c == "\n")
            if !sep
                token += c
            elif size(token) > 0
                var nums = PanelText.numbers(token)
                if size(nums) != 2 || nums[0] < 1 || nums[1] < 1 return nil end
                for p: places
                    if p[0] == nums[0] && p[1] == nums[1] return nil end
                end
                places.push([nums[0], nums[1]])
                token = ""
            end
            i += 1
        end
        return size(places) > 0 ? places : nil
    end

    # a size, [rows, cols]: one token of two numbers, "3x4"
    static def parse_size(text)
        var places = PanelText.parse_places(text)
        if places == nil || size(places) != 1 return nil end
        return places[0]
    end

    # A slot is row * SLOT + col, both from 1 and relative to its zone's card.
    # The glass never shows one: the views write the screen's own place.
    static var SLOT = 100
    static def slot_row(slot) return slot / PanelText.SLOT end
    static def slot_col(slot) return slot % PanelText.SLOT end
    static def make_slot(row, col) return row * PanelText.SLOT + col end

    # [2, 5] -> "2,5"
    static def format_place(place)
        return str(place[0]) + "," + str(place[1])
    end

    # [3, 4] -> "3x4"
    static def format_size(sz)
        return str(sz[0]) + "x" + str(sz[1])
    end
end
