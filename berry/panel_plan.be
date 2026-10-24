# panel_plan.be -- where a card goes on a plan's matrix of cells.
#
# Reading order over the plan's cells: the highest free place a block fits in
# and, among those, the leftmost. A block is [col, row, cols,
# rows], counted in cells from 0; a matrix is [cols, rows].
#
# Static functions only, over blocks and a matrix: the store places the cards
# it adds (panel_store.be), and the plan moves the dashed one
# (panel_plan_view.be).

#@ solidify:PanelPlan
class PanelPlan
    static def overlaps(a, b)
        return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
    end

    static def fits_at(blocks, matrix, col, row, cols, rows)
        if col < 0 || row < 0 || cols < 1 || rows < 1 || col + cols > matrix[0] || row + rows > matrix[1] return false end
        var b = [col, row, cols, rows]
        for o: blocks
            if PanelPlan.overlaps(o, b) return false end
        end
        return true
    end

    # every place a block fits, in reading order: by row, then by column
    static def places(blocks, matrix, cols, rows)
        var out = []
        for row: 0 .. matrix[1] - 1
            for col: 0 .. matrix[0] - 1
                if PanelPlan.fits_at(blocks, matrix, col, row, cols, rows) out.push([col, row]) end
            end
        end
        return out
    end

    static def place_for(blocks, matrix, cols, rows)
        var p = PanelPlan.places(blocks, matrix, cols, rows)
        return size(p) > 0 ? p[0] : nil
    end

    # the place after (col, row) where the block fits, wrapping: what a tap on
    # the dashed card does
    static def next_place_for(blocks, matrix, cols, rows, col, row)
        var fitting = PanelPlan.places(blocks, matrix, cols, rows)
        if size(fitting) == 0 return nil end
        for p: fitting
            if p[1] > row || (p[1] == row && p[0] > col) return p end
        end
        return fitting[0]
    end

    # where the dashed card appears when + is touched: the first free cell
    static def ghost_start(blocks, matrix)
        var at = PanelPlan.place_for(blocks, matrix, 1, 1)
        return at != nil ? [at[0], at[1], 1, 1] : nil
    end

    # The pieces the cells free(col, row) says are free make, joined across a
    # side and never only at a corner: each a list of its cells,
    # [col, row], in reading order, and the pieces in the reading order of their
    # first cells
    static def pieces(cols, rows, free)
        var of = {}   # a cell, row * cols + col, and the index of its piece
        var n = 0
        for r: 0 .. rows - 1
            for c: 0 .. cols - 1
                if !free(c, r) || of.contains(r * cols + c) continue end
                of[r * cols + c] = n
                var queue = [[c, r]]
                while size(queue) > 0
                    var at = queue[size(queue) - 1]
                    queue.remove(size(queue) - 1)
                    for nb: [[at[0] + 1, at[1]], [at[0] - 1, at[1]], [at[0], at[1] + 1], [at[0], at[1] - 1]]
                        if nb[0] < 0 || nb[1] < 0 || nb[0] >= cols || nb[1] >= rows continue end
                        if !free(nb[0], nb[1]) || of.contains(nb[1] * cols + nb[0]) continue end
                        of[nb[1] * cols + nb[0]] = n
                        queue.push(nb)
                    end
                end
                n += 1
            end
        end
        var out = []
        for i: 0 .. n - 1 out.push([]) end
        for r: 0 .. rows - 1
            for c: 0 .. cols - 1
                var i = of.find(r * cols + c)
                if i != nil out[i].push([c, r]) end
            end
        end
        return out
    end

    # whether a cell is held by one of the blocks
    static def held_by(blocks, cell)
        for b: blocks
            if cell[0] >= b[0] && cell[0] < b[0] + b[2] && cell[1] >= b[1] && cell[1] < b[1] + b[3] return true end
        end
        return false
    end

    # A card of irregular shape: a block takes every cell no
    # other card holds, in one piece or in several. Its holes, [dc, dr] from its
    # corner in reading order, or "outside" off the matrix and "taken" with no
    # free cell
    static def holes_at(blocks, matrix, col, row, cols, rows)
        if col < 0 || row < 0 || cols < 1 || rows < 1 || col + cols > matrix[0] || row + rows > matrix[1] return "outside" end
        var holes = []
        for dr: 0 .. rows - 1
            for dc: 0 .. cols - 1
                if PanelPlan.held_by(blocks, [col + dc, row + dr]) holes.push([dc, dr]) end
            end
        end
        return size(holes) == cols * rows ? "taken" : holes
    end

    # the dashed card moved by a touch on a free cell: its corner there, pulled
    # back onto the matrix, when a cell of it there is free; nil when not
    static def ghost_to(blocks, matrix, cell, cols, rows)
        var col = cell[0] < matrix[0] - cols ? cell[0] : matrix[0] - cols
        var row = cell[1] < matrix[1] - rows ? cell[1] : matrix[1] - rows
        if col < 0 col = 0 end
        if row < 0 row = 0 end
        return isinstance(PanelPlan.holes_at(blocks, matrix, col, row, cols, rows), list) ? [col, row, cols, rows] : nil
    end

    # The dashed card's grid typed: where it is, cut at the
    # plan's edge, around the cards it meets there -- never moved back over
    # them; nil when no cell of it is free
    static def ghost_resized(blocks, matrix, block, cols, rows)
        var col = block[0]
        var row = block[1]
        if col + cols > matrix[0] cols = matrix[0] - col end
        if row + rows > matrix[1] rows = matrix[1] - row end
        return isinstance(PanelPlan.holes_at(blocks, matrix, col, row, cols, rows), list) ? [col, row, cols, rows] : nil
    end
end
