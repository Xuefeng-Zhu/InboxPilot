/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';

/**
 * Property 4: Input error state rendering
 *
 * For any non-empty error string passed to an Input, Select, or Textarea component,
 * the component should render with the error border color (red-500), and display
 * the error message text below the field.
 *
 * Tag: Feature: stitch-ui-implementation, Property 4: Input error state rendering
 * Validates: Requirements 4.5
 */

type ComponentType = 'Input' | 'Select' | 'Textarea';

function renderComponent(componentType: ComponentType, error: string) {
  const testId = 'test-field';

  switch (componentType) {
    case 'Input':
      return render(<Input id={testId} error={error} />);
    case 'Select':
      return render(
        <Select
          id={testId}
          error={error}
          options={[{ value: 'a', label: 'A' }]}
        />
      );
    case 'Textarea':
      return render(<Textarea id={testId} error={error} />);
  }
}

function getFormElement(container: HTMLElement, componentType: ComponentType): HTMLElement {
  const tagMap: Record<ComponentType, string> = {
    Input: 'input',
    Select: 'button',
    Textarea: 'textarea',
  };
  return container.querySelector(tagMap[componentType])!;
}

describe('Feature: stitch-ui-implementation, Property 4: Input error state rendering', () => {
  it('renders error border class (border-[var(--m03-red)]) for any non-empty error string', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ComponentType>('Input', 'Select', 'Textarea'),
        fc.string({ minLength: 1 }),
        (componentType, errorMessage) => {
          const { container } = renderComponent(componentType, errorMessage);
          const element = getFormElement(container, componentType);

          expect(element).toBeDefined();
          expect(element.className).toContain('border-[var(--m03-red)]');

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('displays the error message text in the document', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ComponentType>('Input', 'Select', 'Textarea'),
        fc.string({ minLength: 1 }),
        (componentType, errorMessage) => {
          const { container } = renderComponent(componentType, errorMessage);

          const errorElement = container.querySelector(`#test-field-error`);
          expect(errorElement).not.toBeNull();
          expect(errorElement!.textContent).toBe(errorMessage);

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('form element has aria-describedby linking to the error message', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ComponentType>('Input', 'Select', 'Textarea'),
        fc.string({ minLength: 1 }),
        (componentType, errorMessage) => {
          const { container } = renderComponent(componentType, errorMessage);
          const element = getFormElement(container, componentType);

          const ariaDescribedBy = element.getAttribute('aria-describedby');
          expect(ariaDescribedBy).toBe('test-field-error');

          // Verify the referenced element exists and contains the error text
          const errorElement = container.querySelector(`#${ariaDescribedBy}`);
          expect(errorElement).not.toBeNull();
          expect(errorElement!.textContent).toBe(errorMessage);

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('form element has aria-invalid="true" when error is present', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ComponentType>('Input', 'Select', 'Textarea'),
        fc.string({ minLength: 1 }),
        (componentType, errorMessage) => {
          const { container } = renderComponent(componentType, errorMessage);
          const element = getFormElement(container, componentType);

          expect(element.getAttribute('aria-invalid')).toBe('true');

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });
});
